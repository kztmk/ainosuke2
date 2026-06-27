/**
 * Stripe 課金プラン定義。
 *
 * ここの price ID は **dev / Stripe テストモード**の値。
 * prod 配布時は本番モードの price ID に差し替える（公開鍵と同様、環境ごとに別値）。
 * price ID は秘密情報ではない（Checkout URL 等に現れる）ためアプリ同梱で問題ない。
 *
 * クライアントは選択された priceId を Stripe 拡張の createCheckoutSession（checkout_sessions
 * ドキュメント作成）に渡して決済を開始する。商品の Firestore 同期には依存しない。
 */
export type BillingInterval = 'monthly' | 'yearly';

export interface BillingPlan {
  interval: BillingInterval;
  priceId: string;
  /** 表示用の概算金額（UI ラベル。正は Stripe 側が正準）。 */
  amountLabel: string;
}

export const BILLING_PLANS: readonly BillingPlan[] = [
  { interval: 'monthly', priceId: 'price_1TmfLHJXYwHieKAyeSrg8VZw', amountLabel: '$5 / 月' },
  { interval: 'yearly', priceId: 'price_1TmfMWJXYwHieKAy9utAke33', amountLabel: '$48 / 年' },
];

export function planByInterval(interval: BillingInterval): BillingPlan {
  const plan = BILLING_PLANS.find((p) => p.interval === interval);
  if (!plan) throw new Error(`unknown billing interval: ${interval}`);
  return plan;
}
