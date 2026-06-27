/**
 * licenseSync — ライセンストークンのバックグラウンド自動更新（renderer アプリ全体で常駐）。
 *
 * トークンは exp=min(now+30日, サブスク期限) でローリング発行される（ADR-0006）。長期起動や
 * 月次更新で失効しないよう、サインイン中かつサブスク有効なときに exp 接近/grace で再発行する。
 * ライセンス画面を開いていなくても動くよう App 起動時に一度だけ start する。
 *
 * 方針:
 * - サブスク無効時は試行しない（解約後は猶予を経て自然に Free へ＝正しい挙動）。
 * - 6時間間隔＋ウィンドウフォーカス時＋サブスク状態変化時にチェック。直近60秒は再試行しない。
 * - 更新成功時は window の 'license-changed' を発火し、UI（LicenseSection）が status を再取得する。
 */
import type { LicenseStatus } from '../../shared/domain.js';
import { deviceLabel, issueLicense, onAuth, watchActiveSubscription, type User } from './client.js';

export const LICENSE_CHANGED_EVENT = 'license-changed';

const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000; // exp の7日前から更新
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6時間ごと
const MIN_ATTEMPT_GAP_MS = 60_000; // 直近60秒は再試行しない

let started = false;

function shouldRefresh(status: LicenseStatus, now: number): boolean {
  if (status.tier !== 'pro') return true; // サブスク有効なのに Pro でない → 取得を試みる
  if (status.reason === 'grace') return true;
  if (status.expiresAt) {
    const exp = new Date(status.expiresAt).getTime();
    if (exp - now < REFRESH_BEFORE_MS) return true;
  }
  return false;
}

export function startLicenseAutoRefresh(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  let user: User | null = null;
  let subActive = false;
  let lastAttempt = 0;
  let unsubSub: (() => void) | null = null;

  const attempt = async (): Promise<void> => {
    if (!user || !subActive) return;
    const now = Date.now();
    if (now - lastAttempt < MIN_ATTEMPT_GAP_MS) return;

    const status = await window.api.license.status();
    if (!shouldRefresh(status, now)) return;
    lastAttempt = now;
    try {
      const deviceId = await window.api.license.deviceId();
      const issued = await issueLicense(deviceId, deviceLabel());
      const res = await window.api.license.activate(issued.token);
      if (res.ok) window.dispatchEvent(new Event(LICENSE_CHANGED_EVENT));
    } catch {
      /* no-active-subscription / device-limit 等は放置（自然失効に委ねる） */
    }
  };

  onAuth((u) => {
    user = u;
    unsubSub?.();
    unsubSub = null;
    subActive = false;
    if (u) {
      unsubSub = watchActiveSubscription(u.uid, (active) => {
        subActive = active;
        void attempt();
      });
    }
  });

  window.setInterval(() => void attempt(), CHECK_INTERVAL_MS);
  window.addEventListener('focus', () => void attempt());
}
