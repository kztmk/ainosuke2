/**
 * Firebase Web アプリ構成（dev）。
 *
 * apiKey は Firebase では公開前提の識別子（秘密鍵ではない）なのでアプリ同梱でよい。
 * prod 配布時は本番プロジェクト（mcp-switchpoint-wp-prod）の構成へ差し替える。
 * Functions は東京（自作 issueLicense と同一）に揃える。
 */
export const firebaseConfig = {
  apiKey: '***REMOVED_FIREBASE_API_KEY***',
  authDomain: 'mcp-switchpoint-wp-dev.firebaseapp.com',
  projectId: 'mcp-switchpoint-wp-dev',
  storageBucket: 'mcp-switchpoint-wp-dev.firebasestorage.app',
  messagingSenderId: '486215991318',
  appId: '1:486215991318:web:6227e6f4005f8d8e997537',
} as const;

/** 自作 callable（issueLicense 等）と Stripe 拡張のリージョン。 */
export const FUNCTIONS_REGION = 'asia-northeast1';

/**
 * Checkout 後のブラウザ戻り先（プレースホルダ）。
 * 実際の Pro 反映はアプリが Firestore のサブスク状態を監視して自動検出するため、
 * この URL の見た目は重要ではない（決済完了後ブラウザは閉じてアプリへ戻ればよい）。
 */
export const CHECKOUT_RETURN_URL = 'https://example.com/wp-mcp-manager/checkout-complete';
