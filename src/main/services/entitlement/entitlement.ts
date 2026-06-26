/**
 * entitlement — Free/Pro ゲートの「構造」のみ（ADR-0004）。
 *
 * Phase 1 は enforcement を OFF にして全機能アンロックで提供し、Phase 3 の課金有効化と同時に
 * フラグ一つで強制を ON にする。各機能の入口はこの単一サービスの can()/siteLimit() に通す。
 */

import type { Feature, Tier } from '../../../shared/domain.js';
import { FREE_SITE_LIMIT } from '../../../shared/domain.js';

// 共有ドメイン型を再エクスポート（後方互換・呼び出し側の利便）
export type { Feature, Tier } from '../../../shared/domain.js';
export { FREE_SITE_LIMIT } from '../../../shared/domain.js';

const PRO_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'site.unlimited',
  'monitor.background',
  'claude.autoRestart',
  'warn.connection24h',
  'log.csvExport',
  'template.manage',
  'auth.oauth',
  'image.aiEngine',
  'config.profiles',
]);

export interface EntitlementState {
  tier: Tier;
  /** ADR-0004: Phase 1 は false（強制せず全アンロック）。Phase 3 で true。 */
  enforcementEnabled: boolean;
}

export class EntitlementService {
  constructor(private state: EntitlementState) {}

  setState(state: EntitlementState): void {
    this.state = state;
  }

  /** ライセンス判定の結果を反映する（enforcement フラグは保持）。 */
  setTier(tier: Tier): void {
    this.state = { ...this.state, tier };
  }

  get tier(): Tier {
    return this.state.tier;
  }

  /** 機能が使えるか。強制 OFF なら常に true（全アンロック）。 */
  can(feature: Feature): boolean {
    if (!this.state.enforcementEnabled) return true;
    if (this.state.tier === 'pro') return true;
    return !PRO_FEATURES.has(feature);
  }

  /** 登録可能サイト数の上限。強制 OFF なら無制限。 */
  siteLimit(): number {
    if (!this.state.enforcementEnabled) return Infinity;
    return this.state.tier === 'pro' ? Infinity : FREE_SITE_LIMIT;
  }

  canAddSite(currentCount: number): boolean {
    return currentCount < this.siteLimit();
  }
}
