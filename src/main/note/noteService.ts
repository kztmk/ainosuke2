/**
 * NoteService — note 投稿先の「ログイン・接続・ホスト常駐」を束ねるオーケストレータ（ADR-0008 D）。
 *
 * 責務:
 *  - login(): BrowserWindow ログイン → 全 Cookie を暗号化保存（NoteSessionStore）
 *  - connect(): ホストを起動（未起動なら）し、config に bridge エントリを書く（URL/token は毎起動で更新）
 *  - disconnect()/logout(): config から外す・セッション破棄・ホスト停止
 *
 * すべての Electron 依存（ログイン窓・ホスト起動）は注入し、ロジックを DI でテストする。
 */
import { NoteClient } from '../../../packages/note-core/src/index.js';
import type { ConfigWriter, WriteResult } from '../services/configWriter/configWriter.js';
import type { NoteHost } from './host.js';
import { performNoteLogin, type NoteLoginBrowser } from './login.js';
import type { NoteSessionStore } from './session.js';
import type { NoteLoginState } from '../../shared/domain.js';

export interface NoteServiceDeps {
  session: NoteSessionStore;
  configWriter: ConfigWriter;
  /** 同梱 note-bridge.mjs の絶対パス（config に書く）。 */
  bridgePath: string;
  /** bridge を起動する node 実行ファイル（既定 'node'）。実機ではアプリ同梱 Electron を推奨。 */
  nodePath?: string;
  /** bridge へ渡す追加 env（例: `ELECTRON_RUN_AS_NODE: '1'`）。 */
  extraEnv?: Record<string, string>;
  /** ホスト起動（Electron 側は startNoteHost を渡す）。 */
  startHost: (client: NoteClient) => Promise<NoteHost>;
  /** ログイン窓を作る（Electron 側は createNoteLoginBrowser を渡す）。 */
  createLoginBrowser: () => NoteLoginBrowser & { close(): void };
  /** ログイン待ちの調整（テスト用に短縮可能）。 */
  loginTuning?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

export type NoteConnectResult = WriteResult | { ok: false; reason: 'needs_login' };

export class NoteService {
  private host: NoteHost | undefined;

  constructor(private readonly deps: NoteServiceDeps) {}

  /** ログイン軸の状態（CONTEXT.md）。 */
  loginState(): NoteLoginState {
    return this.deps.session.loginState();
  }

  /** 最後に確認した note ID（urlname）。 */
  getUrlname(): string | null {
    return this.deps.session.getUrlname();
  }

  /** ホストが起動中か（＝Claude から実際に使える前提の一つ）。 */
  isHostRunning(): boolean {
    return this.host !== undefined;
  }

  /**
   * BrowserWindow ログイン。成功時に全 Cookie＋urlname を暗号化保存する。
   * reCAPTCHA はユーザーが窓で手動で解く。
   */
  async login(): Promise<{ ok: boolean; urlname?: string; reason?: 'timeout' | 'encryption_unavailable' }> {
    const browser = this.deps.createLoginBrowser();
    try {
      const r = await performNoteLogin({ browser, ...this.deps.loginTuning });
      if (!r.ok) return { ok: false, reason: 'timeout' };
      const saved = this.deps.session.save(r.cookies, r.urlname);
      if (!saved.ok) return { ok: false, reason: 'encryption_unavailable' };
      return { ok: true, urlname: r.urlname };
    } finally {
      browser.close();
    }
  }

  /**
   * 接続（config に bridge エントリを書く）。ログインしていなければ needs_login。
   * ホスト未起動なら起動し、その URL/token を config に反映（毎起動で更新）。
   */
  async connect(target: { managerId: string; displayName: string }): Promise<NoteConnectResult> {
    if (this.loginState() !== 'logged_in') return { ok: false, reason: 'needs_login' };
    const host = await this.ensureHost();
    return this.deps.configWriter.connectNote({
      managerId: target.managerId,
      displayName: target.displayName,
      bridgePath: this.deps.bridgePath,
      bridgeUrl: host.url,
      bridgeToken: host.token,
      nodePath: this.deps.nodePath,
      extraEnv: this.deps.extraEnv,
    });
  }

  /** 接続解除（config から自社エントリ削除）。他に note 接続が無ければホストも停止。 */
  async disconnect(managerId: string): Promise<WriteResult> {
    const r = await this.deps.configWriter.disconnect(managerId);
    await this.stopHost();
    return r;
  }

  /** ログアウト（セッション破棄＋ホスト停止）。managerId 指定時は config からも外す。 */
  async logout(managerId?: string): Promise<void> {
    this.deps.session.clear();
    await this.stopHost();
    if (managerId) await this.deps.configWriter.disconnect(managerId);
  }

  /** アプリ終了時などの後始末。 */
  async dispose(): Promise<void> {
    await this.stopHost();
  }

  private async ensureHost(): Promise<NoteHost> {
    if (this.host) return this.host;
    const client = new NoteClient({ getCookies: () => this.deps.session.getCookies() ?? {} });
    this.host = await this.deps.startHost(client);
    return this.host;
  }

  private async stopHost(): Promise<void> {
    if (this.host) {
      await this.host.close();
      this.host = undefined;
    }
  }
}
