/**
 * IPC 境界の契約 — main（ipcMain.handle 実装）/ preload（contextBridge で公開）/
 * renderer（window.api 呼び出し）の三者が共有する。
 *
 * 設計原則（プラン §0 / §3）:
 * - 平文アプリパスワードは renderer に渡さない。secret は set/has のみ（get は存在しない）。
 * - すべて非同期（ipcRenderer.invoke 経由）。
 * - 例外を投げず、失敗は結果オブジェクトで表現する（呼び出し側で分岐）。
 */
import type {
  AppSettings,
  ArticleTemplate,
  AuthMethod,
  Feature,
  LicenseStatus,
  LogEntry,
  LogType,
  Site,
  SiteWarning,
} from './domain.js';

export type LicenseActivateResult =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' };

/** Google サインイン（main のループバック OAuth）の結果。idToken は renderer が signInWithCredential に使う。 */
export type GoogleSignInResult =
  | { ok: true; idToken: string }
  | {
      ok: false;
      reason: 'not_configured' | 'cancelled' | 'state_mismatch' | 'token_exchange_failed' | 'no_id_token' | 'error';
      message?: string;
    };

/** サイト作成/編集の入力。認証情報（平文）は含めず secret.set で別途渡す。 */
export interface SiteInput {
  name: string;
  url: string;
  authMethod: AuthMethod;
  username: string;
  /** 省略時は DEFAULT_MCP_ENDPOINT */
  mcpEndpoint?: string;
  memo?: string;
}

export type SecretSetResult =
  | { ok: true }
  | { ok: false; reason: 'encryption_unavailable' };

/** サイト作成/編集の結果。表示名の一意性（§5.1.1）違反などを表現。 */
export type SiteMutationResult =
  | { ok: true; site: Site }
  | { ok: false; reason: 'duplicate_name' | 'not_found'; message: string };

/** 接続トグル（config 書き込み/削除）の結果。 */
export type ConnectResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'parse_error' // 既存 config 破損（configWriter）
        | 'key_collision' // 表示名キー衝突（ADR-0001）
        | 'secret_missing' // 認証情報が未保存/復号不可
        | 'encryption_unavailable'; // safeStorage 利用不可（未決#1）
      message: string;
    };

/** 接続テスト（§5.3.1）の結果。REST と MCP を分けて返す。 */
export interface TestResult {
  rest: {
    ok: boolean;
    status?: number;
    error?: string;
    publishedCount: number | null;
  };
  mcp: {
    ok: boolean;
    serverVersion: string | null;
    protocolVersion?: string | null;
    error?: string;
  };
}

/** 接続テストの対象: 保存済みサイト or ダイアログ上の未保存ドラフト（保存前テスト・§8.2）。 */
export type TestTarget =
  | { kind: 'site'; siteId: string }
  | { kind: 'draft'; input: SiteInput; applicationPassword: string };

export interface LogFilter {
  siteId?: string;
  type?: LogType;
}

export interface TemplateInput {
  name: string;
  body: string;
}

/** 自動再起動の推奨（§5.2.2・デバウンス後にまとめて通知）。 */
export interface RestartRecommendedPayload {
  siteIds: string[];
}

/** renderer に公開する API 形状（= window.api）。 */
export interface IpcApi {
  sites: {
    list(): Promise<Site[]>;
    get(id: string): Promise<Site | null>;
    create(input: SiteInput): Promise<SiteMutationResult>;
    update(id: string, input: SiteInput): Promise<SiteMutationResult>;
    remove(id: string): Promise<void>;
    reorder(orderedIds: string[]): Promise<void>;
  };

  /** 認証情報。set はダイアログ入力を main へ渡し即暗号化。get は存在しない（平文を出さない）。 */
  secret: {
    set(siteId: string, applicationPassword: string): Promise<SecretSetResult>;
    has(siteId: string): Promise<boolean>;
  };

  test: {
    run(target: TestTarget): Promise<TestResult>;
  };

  sync: {
    /** WordPress からサマリー＋ステータスを再取得し、更新後の Site を返す（Free・読み取り専用）。 */
    run(siteId: string): Promise<Site>;
  };

  connection: {
    /** 接続（トグル ON）。テスト未実施/失敗時の確認は呼び出し前に renderer 側で。 */
    on(siteId: string): Promise<ConnectResult>;
    /** 接続解除（トグル OFF）。 */
    off(siteId: string): Promise<ConnectResult>;
  };

  claude: {
    detect(): Promise<boolean>;
    configPath(): Promise<string>;
    /** 進行中の会話が中断される旨の確認は呼び出し前に renderer 側で（§5.2.2）。 */
    restart(): Promise<void>;
    /** アンインストール準備: 自社エントリを全削除（ADR-0005）。 */
    removeAllOwned(): Promise<ConnectResult>;
  };

  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };

  entitlement: {
    can(feature: Feature): Promise<boolean>;
    siteLimit(): Promise<number>;
  };

  log: {
    list(filter?: LogFilter): Promise<LogEntry[]>;
    /** CSV エクスポート（Pro・§12.1）。Free では null を返す。 */
    exportCsv(filter?: LogFilter): Promise<string | null>;
  };

  /** サイトへの注意喚起（24h 接続継続〔Pro〕・90 日ローテーション〔Free〕）。 */
  warnings: {
    list(): Promise<SiteWarning[]>;
  };

  /** 記事テンプレート管理（Pro・§12.1）。 */
  templates: {
    list(): Promise<ArticleTemplate[]>;
    create(input: TemplateInput): Promise<ArticleTemplate>;
    update(id: string, input: TemplateInput): Promise<ArticleTemplate | null>;
    remove(id: string): Promise<void>;
  };

  /** Pro ライセンス（§12.2）。入手手段は将来 Firebase Auth に差し替え（LicenseProvider）。 */
  license: {
    status(): Promise<LicenseStatus>;
    deviceId(): Promise<string>;
    activate(token: string): Promise<LicenseActivateResult>;
    deactivate(): Promise<void>;
  };

  /** アカウント認証（Pro ライセンスのアカウント連携・段階2）。 */
  auth: {
    /** Google サインイン: main がシステムブラウザでループバック OAuth を行い ID トークンを返す。 */
    googleSignIn(): Promise<GoogleSignInResult>;
  };

  shell: {
    /** OS 既定ブラウザで開く（§5.1.4）。 */
    openExternal(url: string): Promise<void>;
  };

  /** main → renderer のプッシュ通知。戻り値は購読解除関数。 */
  events: {
    onSiteStatusChanged(cb: (site: Site) => void): () => void;
    /** safeStorage 可用性の変化（縮退バナー制御・未決#1）。 */
    onEncryptionAvailabilityChanged(cb: (available: boolean) => void): () => void;
    /** 再起動推奨トースト（§5.2.2）。 */
    onRestartRecommended(cb: (payload: RestartRecommendedPayload) => void): () => void;
  };
}

/**
 * IPC チャンネル名。main の ipcMain.handle と preload の ipcRenderer.invoke で共有する。
 * invoke 系（要求/応答）とイベント系（main→renderer 片方向）を分離。
 */
export const IPC_INVOKE = {
  sitesList: 'sites:list',
  sitesGet: 'sites:get',
  sitesCreate: 'sites:create',
  sitesUpdate: 'sites:update',
  sitesRemove: 'sites:remove',
  sitesReorder: 'sites:reorder',
  secretSet: 'secret:set',
  secretHas: 'secret:has',
  testRun: 'test:run',
  syncRun: 'sync:run',
  connectionOn: 'connection:on',
  connectionOff: 'connection:off',
  claudeDetect: 'claude:detect',
  claudeConfigPath: 'claude:configPath',
  claudeRestart: 'claude:restart',
  claudeRemoveAllOwned: 'claude:removeAllOwned',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  entitlementCan: 'entitlement:can',
  entitlementSiteLimit: 'entitlement:siteLimit',
  logList: 'log:list',
  logExportCsv: 'log:exportCsv',
  warningsList: 'warnings:list',
  templatesList: 'templates:list',
  templatesCreate: 'templates:create',
  templatesUpdate: 'templates:update',
  templatesRemove: 'templates:remove',
  licenseStatus: 'license:status',
  licenseDeviceId: 'license:deviceId',
  licenseActivate: 'license:activate',
  licenseDeactivate: 'license:deactivate',
  authGoogleSignIn: 'auth:googleSignIn',
  shellOpenExternal: 'shell:openExternal',
} as const;

export const IPC_EVENT = {
  siteStatusChanged: 'event:siteStatusChanged',
  encryptionAvailabilityChanged: 'event:encryptionAvailabilityChanged',
  restartRecommended: 'event:restartRecommended',
} as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE)[keyof typeof IPC_INVOKE];
export type IpcEventChannel = (typeof IPC_EVENT)[keyof typeof IPC_EVENT];

declare global {
  interface Window {
    api: IpcApi;
  }
}
