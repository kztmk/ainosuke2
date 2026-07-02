/**
 * NoteController — IPC と NoteService の間の薄いポリシー層。
 * 本アプリは「1 アプリ = 1 note アカウント」を前提に、managerId（config 識別子）と
 * connected フラグを永続化し、NoteStatus / 起動時再接続を提供する。
 * 複数 note アカウント対応は将来、note 投稿先ストアの導入で拡張する。
 */
import type { NoteConnectResult, NoteLoginResult, NoteStatus } from '../../shared/ipc.js';
import type { KeyValueStore } from '../services/secretStore/secretStore.js';
import type { NoteService } from './noteService.js';

const MANAGER_ID_KEY = 'note.managerId';
const CONNECTED_KEY = 'note.connected';

export interface NoteControllerDeps {
  service: NoteService;
  kv: KeyValueStore;
  idFactory: () => string;
  /** config の mcpServers キーに使う表示名。既定 "note: <urlname>"。 */
  displayName?: (urlname: string | null) => string;
}

export class NoteController {
  constructor(private readonly deps: NoteControllerDeps) {}

  private managerId(): string {
    let id = this.deps.kv.get(MANAGER_ID_KEY);
    if (!id) {
      id = this.deps.idFactory();
      this.deps.kv.set(MANAGER_ID_KEY, id);
    }
    return id;
  }

  private displayName(): string {
    const urlname = this.deps.service.getUrlname();
    return this.deps.displayName ? this.deps.displayName(urlname) : `note: ${urlname ?? 'アカウント'}`;
  }

  private isConnected(): boolean {
    return this.deps.kv.get(CONNECTED_KEY) === '1';
  }
  private setConnected(v: boolean): void {
    this.deps.kv.set(CONNECTED_KEY, v ? '1' : '0');
  }

  status(): NoteStatus {
    return {
      loginState: this.deps.service.loginState(),
      urlname: this.deps.service.getUrlname(),
      hostRunning: this.deps.service.isHostRunning(),
      connected: this.isConnected(),
    };
  }

  async login(): Promise<NoteLoginResult> {
    const r = await this.deps.service.login();
    if (r.ok) return { ok: true, urlname: r.urlname ?? '' };
    return { ok: false, reason: r.reason ?? 'timeout' };
  }

  async logout(): Promise<void> {
    await this.deps.service.logout(this.managerId());
    this.setConnected(false);
  }

  async connect(): Promise<NoteConnectResult> {
    const r = await this.deps.service.connect({ managerId: this.managerId(), displayName: this.displayName() });
    if (r.ok) {
      this.setConnected(true);
      return { ok: true };
    }
    if (r.reason === 'needs_login') return { ok: false, reason: 'needs_login' };
    return { ok: false, reason: r.reason, message: r.message };
  }

  async disconnect(): Promise<NoteConnectResult> {
    const r = await this.deps.service.disconnect(this.managerId());
    this.setConnected(false);
    if (r.ok) return { ok: true };
    // disconnect は configWriter 由来（parse_error 等）。needs_login は起きない。
    return { ok: false, reason: r.reason === 'key_collision' ? 'key_collision' : 'parse_error', message: r.message };
  }

  /** 起動時: ログイン中かつ接続中なら config を再確立（新しい host URL/token を反映）。 */
  async resumeOnStartup(): Promise<void> {
    if (this.deps.service.loginState() === 'logged_in' && this.isConnected()) {
      await this.deps.service.connect({ managerId: this.managerId(), displayName: this.displayName() });
    }
  }

  /** アプリ終了時の後始末（ホスト停止）。 */
  async dispose(): Promise<void> {
    await this.deps.service.dispose();
  }
}
