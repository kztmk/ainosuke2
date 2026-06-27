/**
 * Firebase Web アプリ構成。
 *
 * 値は `.env.dev` / `.env.prod`（gitignore）の VITE_FIREBASE_* から electron.vite.config.ts が
 * ビルド時に `__FIREBASE_CONFIG__` として注入する。apiKey は Firebase では公開前提の識別子だが、
 * GitHub Secret Scanning 回避と dev/prod 切替のためリポジトリには置かない（テンプレ=.env.example）。
 * 保護は Firestore セキュリティルール＋（将来）App Check で担保する。
 */
declare const __FIREBASE_CONFIG__: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export const firebaseConfig = __FIREBASE_CONFIG__;

/** 自作 callable（issueLicense 等）と Stripe 拡張のリージョン。 */
export const FUNCTIONS_REGION = 'asia-northeast1';

/**
 * Checkout 後のブラウザ戻り先（プレースホルダ）。
 * 実際の Pro 反映はアプリが Firestore のサブスク状態を監視して自動検出するため、
 * この URL の見た目は重要ではない（決済完了後ブラウザは閉じてアプリへ戻ればよい）。
 */
export const CHECKOUT_RETURN_URL = 'https://example.com/wp-mcp-manager/checkout-complete';
