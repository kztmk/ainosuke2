/**
 * AppService — main プロセスのオーケストレーション層。各サービスを束ね、IpcApi のメソッドに対応する
 * 多段フロー（接続 = 秘密取得→config 書き込み→状態永続化→ログ）と Site DTO 組み立てを担う。
 *
 * Electron に依存しない。ipcMain.handle への結線は別の薄いアダプタが行う（このクラスを呼ぶだけ）。
 * 本物の safeStorage/fetch/electron-store/child_process は各サービスへ注入済みの前提。
 */
import {
  DEFAULT_MCP_ENDPOINT,
  type AppSettings,
  type HealthStatus,
  type Site,
  type SiteRecord,
  type SiteSummary,
} from '../../shared/domain.js';
import type {
  ConnectResult,
  LogFilter,
  SecretSetResult,
  SiteInput,
  SiteMutationResult,
  TestResult,
  TestTarget,
} from '../../shared/ipc.js';
import type { ConfigWriter } from '../services/configWriter/configWriter.js';
import type { SiteStore } from '../services/siteStore/siteStore.js';
import type { SecretStore } from '../services/secretStore/secretStore.js';
import type { WpClient, BasicAuth } from '../services/wpClient/wpClient.js';
import type { McpClient } from '../services/mcpClient/mcpClient.js';
import type { EntitlementService } from '../services/entitlement/entitlement.js';
import type { ClaudeDesktopService } from '../services/claudeDesktop/claudeDesktop.js';
import type { Logger } from '../services/logger/logger.js';
import type { Feature } from '../../shared/domain.js';

export interface SettingsStore {
  read(): AppSettings;
  write(settings: AppSettings): void;
}

export interface AppServiceDeps {
  sites: SiteStore;
  secrets: SecretStore;
  config: ConfigWriter;
  wp: WpClient;
  mcp: McpClient;
  entitlement: EntitlementService;
  claude: ClaudeDesktopService;
  logger: Logger;
  settings: SettingsStore;
  openExternal: (url: string) => Promise<void>;
  now?: () => Date;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class AppService {
  private readonly d: AppServiceDeps;
  private readonly now: () => Date;
  /** 接続中だが Claude Desktop 未再起動のサイト（接続中・再起動待ちの判定）。 */
  private readonly pendingRestart = new Set<string>();
  /** 疎通結果のキャッシュ（health / summary）。test/sync で更新。 */
  private readonly runtime = new Map<string, { health: HealthStatus; summary: SiteSummary | null }>();

  constructor(deps: AppServiceDeps) {
    this.d = deps;
    this.now = deps.now ?? (() => new Date());
  }

  // --- Site DTO 組み立て ---------------------------------------------------

  private assemble(record: SiteRecord): Site {
    const rt = this.runtime.get(record.id);
    const connection = !record.enabled
      ? 'saved'
      : this.pendingRestart.has(record.id)
        ? 'connected_pending_restart'
        : 'connected_active';
    return {
      ...record,
      hasSecret: this.d.secrets.has(record.id),
      connection,
      health: rt?.health ?? 'unverified',
      summary: rt?.summary ?? null,
    };
  }

  private mcpEndpointUrl(record: { url: string; mcpEndpoint: string }): string {
    return `${trimTrailingSlash(record.url)}${record.mcpEndpoint}`;
  }

  // --- sites ---------------------------------------------------------------

  sitesList(): Site[] {
    return this.d.sites.list().map((r) => this.assemble(r));
  }

  sitesGet(id: string): Site | null {
    const r = this.d.sites.get(id);
    return r ? this.assemble(r) : null;
  }

  sitesCreate(input: SiteInput): SiteMutationResult {
    const res = this.d.sites.create(input);
    if (!res.ok) {
      return { ok: false, reason: 'duplicate_name', message: '同じ表示名のサイトが既に登録されています。' };
    }
    this.d.logger.record({ type: 'site.add', siteId: res.record.id, result: 'ok' });
    return { ok: true, site: this.assemble(res.record) };
  }

  sitesUpdate(id: string, input: SiteInput): SiteMutationResult {
    const res = this.d.sites.update(id, input);
    if (!res.ok) {
      const message =
        res.reason === 'duplicate_name'
          ? '同じ表示名のサイトが既に登録されています。'
          : 'サイトが見つかりません。';
      return { ok: false, reason: res.reason, message };
    }
    this.d.logger.record({ type: 'site.edit', siteId: id, result: 'ok' });
    return { ok: true, site: this.assemble(res.record) };
  }

  /** 削除（§5.1.3）: config から自社エントリを除去し、秘密・レコードも削除する。 */
  async sitesRemove(id: string): Promise<void> {
    await this.d.config.disconnect(id); // 破損 config 等の失敗はローカル削除を妨げない（ベストエフォート）
    this.d.secrets.remove(id);
    this.d.sites.remove(id);
    this.pendingRestart.delete(id);
    this.runtime.delete(id);
    this.d.logger.record({ type: 'site.delete', siteId: id, result: 'ok' });
  }

  sitesReorder(orderedIds: string[]): void {
    this.d.sites.reorder(orderedIds);
  }

  // --- secret --------------------------------------------------------------

  /** アプリパスワードの保存。成功時は secretUpdatedAt の起点を更新（90日ローテーション）。 */
  secretSet(siteId: string, applicationPassword: string): SecretSetResult {
    const res = this.d.secrets.set(siteId, applicationPassword);
    if (res.ok) this.d.sites.markSecretUpdated(siteId);
    return res;
  }

  secretHas(siteId: string): boolean {
    return this.d.secrets.has(siteId);
  }

  // --- connection（トグル） ------------------------------------------------

  async connectionOn(siteId: string): Promise<ConnectResult> {
    const site = this.d.sites.get(siteId);
    if (!site) return { ok: false, reason: 'secret_missing', message: 'サイトが見つかりません。' };

    const sec = this.d.secrets.get(siteId);
    if (sec.status === 'encryption_unavailable') {
      return { ok: false, reason: 'encryption_unavailable', message: 'OS の暗号化が利用できないため接続できません。' };
    }
    if (sec.status !== 'ok') {
      return { ok: false, reason: 'secret_missing', message: '認証情報が未保存、または再入力が必要です。' };
    }

    const settings = this.d.settings.read();
    const res = await this.d.config.connect({
      managerId: site.id,
      displayName: site.name,
      apiUrl: this.mcpEndpointUrl(site),
      username: site.username,
      applicationPassword: sec.password,
      pinnedVersion: settings.pinnedRemoteVersion,
    });
    if (!res.ok) {
      this.d.logger.record({ type: 'connect', siteId, result: 'error', message: res.message });
      return { ok: false, reason: res.reason, message: res.message };
    }

    this.d.sites.setConnectionState(siteId, true, this.now().toISOString());
    this.pendingRestart.add(siteId);
    this.d.logger.record({ type: 'connect', siteId, result: 'ok' });
    return { ok: true };
  }

  async connectionOff(siteId: string): Promise<ConnectResult> {
    const res = await this.d.config.disconnect(siteId);
    if (!res.ok) {
      this.d.logger.record({ type: 'disconnect', siteId, result: 'error', message: res.message });
      return { ok: false, reason: res.reason, message: res.message };
    }
    this.d.sites.setConnectionState(siteId, false, null);
    this.pendingRestart.delete(siteId);
    this.d.logger.record({ type: 'disconnect', siteId, result: 'ok' });
    return { ok: true };
  }

  // --- test / sync ---------------------------------------------------------

  async testRun(target: TestTarget): Promise<TestResult> {
    let url: string;
    let endpoint: string;
    let username: string;
    let auth: BasicAuth | undefined;
    let siteId: string | null = null;

    if (target.kind === 'site') {
      const site = this.d.sites.get(target.siteId);
      if (!site) {
        return {
          rest: { ok: false, error: 'サイトが見つかりません。', publishedCount: null },
          mcp: { ok: false, serverVersion: null, error: 'サイトが見つかりません。' },
        };
      }
      siteId = site.id;
      url = site.url;
      endpoint = site.mcpEndpoint;
      username = site.username;
      const sec = this.d.secrets.get(site.id);
      auth = sec.status === 'ok' ? { username, applicationPassword: sec.password } : undefined;
    } else {
      url = trimTrailingSlash(target.input.url);
      endpoint = target.input.mcpEndpoint?.trim() || DEFAULT_MCP_ENDPOINT;
      username = target.input.username;
      auth = { username, applicationPassword: target.applicationPassword };
    }

    const rest = await this.d.wp.checkRest(url, auth);
    const restPart: TestResult['rest'] = rest.ok
      ? { ok: true, status: rest.status, publishedCount: rest.publishedCount }
      : { ok: false, status: rest.status, error: rest.error, publishedCount: null };

    let mcpPart: TestResult['mcp'];
    if (!auth) {
      mcpPart = { ok: false, serverVersion: null, error: 'MCP の確認には認証情報が必要です。' };
    } else {
      const init = await this.d.mcp.initialize({ endpointUrl: `${url}${endpoint}`, auth });
      mcpPart = init.ok
        ? { ok: true, serverVersion: init.serverVersion, protocolVersion: init.protocolVersion }
        : { ok: false, serverVersion: null, error: init.error };
    }

    if (siteId) {
      const health: HealthStatus = restPart.ok && mcpPart.ok ? 'ok' : 'error';
      const prev = this.runtime.get(siteId)?.summary ?? null;
      this.runtime.set(siteId, {
        health,
        summary: {
          publishedCount: restPart.publishedCount,
          draftCount: prev?.draftCount ?? null,
          mcpAdapterVersion: mcpPart.ok ? mcpPart.serverVersion : null,
          mcpEndpointReachable: mcpPart.ok,
        },
      });
      this.d.logger.record({ type: 'test', siteId, result: health === 'ok' ? 'ok' : 'error' });
    }

    return { rest: restPart, mcp: mcpPart };
  }

  /** 同期（§5.1.5・Free・読み取り専用）: サマリー＋ステータスを再取得して Site を返す。 */
  async syncRun(siteId: string): Promise<Site> {
    const site = this.d.sites.get(siteId);
    if (!site) throw new Error(`site not found: ${siteId}`);

    const sec = this.d.secrets.get(siteId);
    const auth: BasicAuth | undefined =
      sec.status === 'ok' ? { username: site.username, applicationPassword: sec.password } : undefined;

    const summary = auth
      ? await this.d.wp.fetchSummary(site.url, auth)
      : { publishedCount: null, draftCount: null };

    let version: string | null = null;
    let reachable: boolean | null = null;
    if (auth) {
      const init = await this.d.mcp.initialize({ endpointUrl: this.mcpEndpointUrl(site), auth });
      reachable = init.ok;
      version = init.ok ? init.serverVersion : null;
    }

    const health: HealthStatus = !auth ? 'unverified' : reachable ? 'ok' : 'error';
    this.runtime.set(siteId, {
      health,
      summary: {
        publishedCount: summary.publishedCount,
        draftCount: summary.draftCount,
        mcpAdapterVersion: version,
        mcpEndpointReachable: reachable,
      },
    });
    this.d.logger.record({ type: 'sync', siteId, result: health === 'error' ? 'error' : 'ok' });
    return this.assemble(this.d.sites.get(siteId)!);
  }

  // --- claude --------------------------------------------------------------

  claudeDetect(): boolean {
    return this.d.claude.detect();
  }

  claudeConfigPath(): string {
    return this.d.claude.resolveConfigPath();
  }

  /** 再起動（§5.2.2）。確認は呼び出し前に renderer で済ませる前提。全接続を反映済みにする。 */
  async claudeRestart(): Promise<void> {
    await this.d.claude.restart();
    this.pendingRestart.clear();
  }

  async claudeRemoveAllOwned(): Promise<ConnectResult> {
    const res = await this.d.config.removeAllOwned();
    if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
    return { ok: true };
  }

  // --- settings / entitlement / log / shell --------------------------------

  settingsGet(): AppSettings {
    return this.d.settings.read();
  }

  settingsUpdate(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.d.settings.read(), ...patch };
    this.d.settings.write(next);
    return next;
  }

  entitlementCan(feature: Feature): boolean {
    return this.d.entitlement.can(feature);
  }

  entitlementSiteLimit(): number {
    return this.d.entitlement.siteLimit();
  }

  logList(filter?: LogFilter): ReturnType<Logger['list']> {
    return this.d.logger.list(filter);
  }

  async shellOpenExternal(url: string): Promise<void> {
    await this.d.openExternal(url);
  }
}
