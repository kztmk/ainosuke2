/**
 * entitlement ゴールデンテスト（ADR-0004 / 12.1 / 未決#2）。
 * 主眼: 「フラグ一つで強制を ON/OFF できる」こと。
 */
import { describe, expect, it } from 'vitest';
import { EntitlementService, FREE_SITE_LIMIT } from './entitlement.js';

describe('Phase 1: enforcement OFF（全アンロック）', () => {
  const svc = () => new EntitlementService({ tier: 'free', enforcementEnabled: false });

  it('Free でも Pro 限定機能がすべて使える', () => {
    const s = svc();
    expect(s.can('monitor.background')).toBe(true);
    expect(s.can('claude.autoRestart')).toBe(true);
    expect(s.can('log.csvExport')).toBe(true);
    expect(s.can('auth.oauth')).toBe(true);
  });

  it('サイト数は無制限', () => {
    const s = svc();
    expect(s.siteLimit()).toBe(Infinity);
    expect(s.canAddSite(100)).toBe(true);
  });
});

describe('Phase 3: enforcement ON + Free', () => {
  const svc = () => new EntitlementService({ tier: 'free', enforcementEnabled: true });

  it('Pro 限定機能はブロックされる', () => {
    const s = svc();
    expect(s.can('monitor.background')).toBe(false);
    expect(s.can('claude.autoRestart')).toBe(false);
    expect(s.can('warn.connection24h')).toBe(false);
  });

  it('Free 機能（セキュリティ・同期）は使える', () => {
    const s = svc();
    expect(s.can('security.rotationWarning')).toBe(true); // 90日警告は Free（未決#2）
    expect(s.can('site.sync')).toBe(true);
  });

  it('サイト数上限は 3 で、3 件目以降は追加不可', () => {
    const s = svc();
    expect(s.siteLimit()).toBe(FREE_SITE_LIMIT);
    expect(s.canAddSite(2)).toBe(true);
    expect(s.canAddSite(3)).toBe(false);
  });
});

describe('Phase 3: enforcement ON + Pro', () => {
  const svc = () => new EntitlementService({ tier: 'pro', enforcementEnabled: true });

  it('すべての機能が使え、サイト数は無制限', () => {
    const s = svc();
    expect(s.can('monitor.background')).toBe(true);
    expect(s.siteLimit()).toBe(Infinity);
  });
});

describe('フラグ切り替えで強制が即時に効く（ADR-0004 の要）', () => {
  it('setState で enforcement を ON にすると同じインスタンスの判定が変わる', () => {
    const s = new EntitlementService({ tier: 'free', enforcementEnabled: false });
    expect(s.canAddSite(5)).toBe(true);

    s.setState({ tier: 'free', enforcementEnabled: true });
    expect(s.canAddSite(5)).toBe(false);
    expect(s.can('monitor.background')).toBe(false);
  });
});
