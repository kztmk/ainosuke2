/** ライセンス発行ポリシー（ADR-0006）。 */

/** Pro の最大同時端末数。 */
export const MAX_DEVICES = 3;

/**
 * 端末数上限の強制。サブスク本来のポリシーなのでトークン発行時は ON。
 * （アプリ機能ロックの enforcement フラグ＝ADR-0004 とは別物。あちらは OFF のまま）
 */
export const ENFORCE_DEVICE_LIMIT = true;

/** 券面 exp の上限（日）。これより先のサブスク期限があっても 30 日でローリング更新する。 */
export const TOKEN_TTL_DAYS = 30;

/** Pro とみなす Stripe サブスクのステータス（拡張が Firestore に同期する値）。 */
export const ACTIVE_STATUSES = ['active', 'trialing'] as const;

/** Functions のリージョン（東京）。Stripe 拡張のリージョンと一致させると遅延が減る。 */
export const REGION = 'asia-northeast1';
