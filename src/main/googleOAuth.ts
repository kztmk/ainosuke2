/**
 * Google OAuth（Desktop / installed app）クライアント設定 — dev。
 *
 * - 種別は **Desktop app**（loopback リダイレクトを任意ポートで許可）。
 * - Desktop 型の client secret は Google の公式見解で「機密ではない」（installed app）。
 *   実保護は PKCE が担うため、アプリ同梱でよい。prod では本番プロジェクトの Desktop クライアントへ差し替える。
 * - この client ID は **Firebase コンソール → Authentication → Sign-in method → Google →
 *   許可リスト（whitelist client IDs）** に登録すること（さもないと id_token audience mismatch）。
 *
 * 未設定（空文字）の間は Google サインインは not_configured を返し、UI はボタンを無効化する。
 */
export const GOOGLE_OAUTH = {
  clientId: '', // 例: 486215991318-xxxxxxxx.apps.googleusercontent.com
  clientSecret: '', // Desktop 型クライアントの secret（非機密）
};
