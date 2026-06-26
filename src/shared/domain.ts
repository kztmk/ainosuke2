/**
 * 共有ドメイン型 — main / preload / renderer の単一の源（single source of truth）。
 * このファイルは Electron にも Node 固有 API にも依存しない純粋な型のみを置く。
 * renderer はここを import してよいが、main の services 実装には依存しない。
 */

/** 認証方式。Phase 1 既定は application_password、jwt は上級オプション、OAuth は Phase 3（ADR-0003）。 */
export type AuthMethod = 'application_password' | 'jwt';

export type Tier = 'free' | 'pro';

export type ThemePref = 'light' | 'dark' | 'system';

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
  pinnedRemoteVersion: '0.3.5',
};

/** MCP エンドポイントの既定スラッグ（§5.1.1） */
export const DEFAULT_MCP_ENDPOINT = '/wp-json/mcp/mcp-adapter-default-server';
