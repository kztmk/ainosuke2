/**
 * 共有ドメイン型 — main / preload / renderer の単一の源（single source of truth）。
 * このファイルは Electron にも Node 固有 API にも依存しない純粋な型のみを置く。
 * renderer はここを import してよいが、main の services 実装には依存しない。
 */

/** 認証方式。Phase 1 既定は application_password、jwt は上級オプション、OAuth は Phase 3（ADR-0003）。 */
export type AuthMethod = 'application_password' | 'jwt';

export type Tier = 'free' | 'pro';

export type ThemePref = 'light' | 'dark' | 'system';

/** 表示言語（§8.5・Phase 1 は ja のみ、Phase 3 で切替 UI）。 */
export type Locale = 'ja' | 'en';

/** ゲート対象機能（PRO_FEATURES に無いものは Free でも使える・ADR-0004 / 12.1）。 */
export type Feature =
  // Pro 限定
  | 'site.unlimited'
  | 'monitor.background'
  | 'claude.autoRestart'
  | 'warn.connection24h'
  | 'log.csvExport'
  | 'template.manage'
  | 'auth.oauth'
  | 'image.aiEngine'
  | 'config.profiles'
  // Free（明示）。セキュリティ系は全 Free（未決#2）
  | 'security.rotationWarning'
  | 'site.sync';

export const FREE_SITE_LIMIT = 3;

export type LogType =
  | 'site.add'
  | 'site.edit'
  | 'site.delete'
  | 'test'
  | 'sync'
  | 'connect'
  | 'disconnect'
  | 'config.update';

export interface LogEntry {
  /** ISO8601 */
  at: string;
  type: LogType;
  siteId?: string;
  result?: 'ok' | 'error';
  message?: string;
}

/**
 * 接続（config/トグル）次元の状態。CONTEXT.md の状態モデルに対応。
 * - saved: 保存済み（config 未記載）
 * - connected_pending_restart: 接続中（再起動待ち）
 * - connected_active: 接続中（反映済み・ベストエフォート判定）
 */
export type ConnectionState = 'saved' | 'connected_pending_restart' | 'connected_active';

/** 疎通バッジ次元（§5.1.2 緑/黄/赤）。 */
export type HealthStatus = 'ok' | 'unverified' | 'error';

/** アプリパスワードの再発行を促す日数（§7・未決#2）。 */
export const ROTATION_WARNING_DAYS = 90;

/**
 * サイトに対する注意喚起（§5.2.3 / §7）。
 * - long_connection: 接続したまま閾値（既定 24h）超過。露出時間の自動監視（Pro）。
 * - rotation_due: アプリパスワード発行から 90 日超過。セキュリティ衛生（Free）。
 */
export type WarningType = 'long_connection' | 'rotation_due';

export interface SiteWarning {
  siteId: string;
  type: WarningType;
}

export interface SiteSummary {
  publishedCount: number | null;
  draftCount: number | null;
  /** MCP `initialize` の serverInfo.version（§5.3.1） */
  mcpAdapterVersion: string | null;
  mcpEndpointReachable: boolean | null;
}

/** 永続化レコード（§6.1）。認証情報（平文）は含まない。 */
export interface SiteRecord {
  id: string;
  name: string;
  url: string;
  authMethod: AuthMethod;
  username: string;
  mcpEndpoint: string;
  memo: string;
  order: number;
  enabled: boolean;
  connectedAt: string | null;
  /** アプリパスワードを最後に更新した日時。90 日ローテーション警告の起点（§7 / 未決#2）。 */
  secretUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** renderer 向け DTO = 永続化レコード ＋ 派生情報。平文は決して含まない。 */
export interface Site extends SiteRecord {
  /** 暗号化済みアプリパスワードが secretStore に存在するか（復号可否は別） */
  hasSecret: boolean;
  connection: ConnectionState;
  health: HealthStatus;
  summary: SiteSummary | null;
}

// ───────────────────────────────────────────────────────────────────────────
// 投稿先（プラットフォーム非依存の上位概念・CONTEXT.md / ADR-0008）
// WordPress の「サイト」と note の「note アカウント」を包含する discriminated union。
// P0 の土台: 既存 WordPress（Site/SiteRecord）は不変のまま、platform 判別で union へ組み込む。
// ───────────────────────────────────────────────────────────────────────────

/** 投稿先のプラットフォーム種別。プラットフォームごとに認証・接続の仕組みが異なる。 */
export type Platform = 'wordpress' | 'note';

/**
 * note のログイン軸（接続=config 軸とは独立・CONTEXT.md）。
 * - logged_in: アプリが有効な note セッションを保持
 * - needs_relogin: セッション失効/未取得（接続中でも Claude から叩くと失敗）
 */
export type NoteLoginState = 'logged_in' | 'needs_relogin';

/** すべての投稿先が共有する基底フィールド（platform で判別）。 */
export interface PostTargetBase {
  id: string;
  name: string;
  platform: Platform;
  order: number;
  enabled: boolean;
  connectedAt: string | null;
  createdAt: string;
  memo: string;
}

/**
 * WordPress 投稿先。既存の Site DTO に platform 判別子を付けたもの（ロスレス）。
 * Site は PostTargetBase の全フィールドを構造的に満たす。
 */
export type WordPressTarget = Site & { platform: 'wordpress' };

/** note 投稿先（DTO）。認証情報は持たず、ログイン状態と最後に確認した note ID を持つ。 */
export interface NoteTarget extends PostTargetBase {
  platform: 'note';
  /** note ID（urlname・例: bungo_ai_nosuke）。/settings/account 読み取りで確定した最後の値。 */
  urlname: string | null;
  /** note 内部ユーザー ID（数値文字列）。 */
  noteUserId: string | null;
  /** ログイン軸の状態（接続とは独立）。 */
  loginState: NoteLoginState;
}

/** 投稿先（プラットフォーム横断の union）。UI 一覧・configWriter の分岐はこれを消費する。 */
export type PostTarget = WordPressTarget | NoteTarget;

/** Pro ライセンスの同時利用台数上限（§12.2・サーバー側で発行時に強制）。 */
export const MAX_DEVICES = 3;
/** オフライン猶予日数（§12.2：再検証できない間も動作継続する期間）。 */
export const LICENSE_OFFLINE_GRACE_DAYS = 14;

/** ライセンストークンのクレーム（発行サーバーが署名・アプリが公開鍵で検証）。 */
export interface LicenseClaims {
  tier: 'pro';
  userId: string;
  deviceId: string;
  /** 発行時刻（unix 秒） */
  iat: number;
  /** 失効時刻（unix 秒） */
  exp: number;
}

/** アプリが提示するライセンス状態。 */
export interface LicenseStatus {
  tier: Tier;
  activated: boolean;
  reason: 'none' | 'valid' | 'grace' | 'expired' | 'invalid';
  expiresAt: string | null;
  userId: string | null;
  deviceId: string | null;
}

/** 記事テンプレート（Pro・§12.1）。Claude への指示に再利用する雛形テキスト。 */
export interface ArticleTemplate {
  id: string;
  name: string;
  /** 雛形本文（構成・トーン・カテゴリ指定などを含むプロンプト） */
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  /** 疎通確認間隔（分・既定 30） */
  pollIntervalMinutes: number;
  checkOnStartup: boolean;
  trayResident: boolean;
  /** ログ保存日数（既定 7） */
  logRetentionDays: number;
  /** 接続継続の警告閾値（時間・既定 24・OFF=null） */
  connectionWarnThresholdHours: number | null;
  theme: ThemePref;
  /** 表示言語（§8.5） */
  language: Locale;
  /** ピン留めする mcp-wordpress-remote のバージョン（未決#3・完全固定） */
  pinnedRemoteVersion: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalMinutes: 30,
  checkOnStartup: true,
  trayResident: true,
  logRetentionDays: 7,
  connectionWarnThresholdHours: 24,
  theme: 'system',
  language: 'ja',
  pinnedRemoteVersion: '0.3.5',
};

/** MCP エンドポイントの既定スラッグ（§5.1.1） */
export const DEFAULT_MCP_ENDPOINT = '/wp-json/mcp/mcp-adapter-default-server';
