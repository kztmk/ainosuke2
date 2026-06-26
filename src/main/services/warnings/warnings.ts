/**
 * warnings — サイトへの注意喚起を算出する純関数（§5.2.3 / §7）。
 * 入力（サイト・設定・現在時刻）から決まり、副作用を持たない。Pro ゲートは呼び出し側で適用する。
 */
import { ROTATION_WARNING_DAYS, type AppSettings, type SiteRecord, type SiteWarning } from '../../../shared/domain.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function elapsedMs(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return now - new Date(iso).getTime();
}

/**
 * 設定に基づき適用される全警告を返す（Pro/Free の区別はしない）。
 * - long_connection: enabled かつ connectedAt が閾値（時間）超過。閾値が null（OFF）なら出さない。
 * - rotation_due: secretUpdatedAt が ROTATION_WARNING_DAYS 超過。
 */
export function computeWarnings(sites: SiteRecord[], settings: AppSettings, now: Date): SiteWarning[] {
  const t = now.getTime();
  const warnings: SiteWarning[] = [];

  for (const site of sites) {
    const threshold = settings.connectionWarnThresholdHours;
    if (threshold != null && site.enabled) {
      const connected = elapsedMs(site.connectedAt, t);
      if (connected != null && connected > threshold * HOUR_MS) {
        warnings.push({ siteId: site.id, type: 'long_connection' });
      }
    }

    const secretAge = elapsedMs(site.secretUpdatedAt, t);
    if (secretAge != null && secretAge > ROTATION_WARNING_DAYS * DAY_MS) {
      warnings.push({ siteId: site.id, type: 'rotation_due' });
    }
  }

  return warnings;
}
