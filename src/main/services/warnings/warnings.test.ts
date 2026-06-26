/** warnings ゴールデンテスト（§5.2.3 / §7）。 */
import { describe, expect, it } from 'vitest';
import { computeWarnings } from './warnings.js';
import { DEFAULT_SETTINGS, type AppSettings, type SiteRecord } from '../../../shared/domain.js';

const NOW = new Date('2026-06-25T12:00:00Z');

function site(overrides: Partial<SiteRecord> = {}): SiteRecord {
  return {
    id: 'id-1',
    name: 'メインブログ',
    url: 'https://example.com',
    authMethod: 'application_password',
    username: 'editor',
    mcpEndpoint: '/wp-json/mcp/mcp-adapter-default-server',
    memo: '',
    order: 0,
    enabled: false,
    connectedAt: null,
    secretUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const settings = (o: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...o });

describe('long_connection（24h 接続継続）', () => {
  it('閾値（24h）を超えて接続中なら警告する', () => {
    const s = site({ enabled: true, connectedAt: '2026-06-24T11:00:00Z' }); // 25h 前
    expect(computeWarnings([s], settings(), NOW)).toEqual([{ siteId: 'id-1', type: 'long_connection' }]);
  });

  it('閾値内なら警告しない', () => {
    const s = site({ enabled: true, connectedAt: '2026-06-25T00:00:00Z' }); // 12h 前
    expect(computeWarnings([s], settings(), NOW)).toEqual([]);
  });

  it('未接続なら警告しない', () => {
    const s = site({ enabled: false, connectedAt: null });
    expect(computeWarnings([s], settings(), NOW)).toEqual([]);
  });

  it('閾値が null（OFF）なら警告しない', () => {
    const s = site({ enabled: true, connectedAt: '2026-06-01T00:00:00Z' });
    expect(computeWarnings([s], settings({ connectionWarnThresholdHours: null }), NOW)).toEqual([]);
  });
});

describe('rotation_due（90 日ローテーション）', () => {
  it('アプリパスワード発行から 90 日超で警告する', () => {
    const s = site({ secretUpdatedAt: '2026-03-01T00:00:00Z' }); // 約 116 日前
    expect(computeWarnings([s], settings(), NOW)).toEqual([{ siteId: 'id-1', type: 'rotation_due' }]);
  });

  it('90 日以内なら警告しない', () => {
    const s = site({ secretUpdatedAt: '2026-06-01T00:00:00Z' }); // 24 日前
    expect(computeWarnings([s], settings(), NOW)).toEqual([]);
  });

  it('未保存（null）なら警告しない', () => {
    expect(computeWarnings([site({ secretUpdatedAt: null })], settings(), NOW)).toEqual([]);
  });
});

describe('複合', () => {
  it('1 サイトが両方該当すれば 2 件返す', () => {
    const s = site({
      enabled: true,
      connectedAt: '2026-06-20T00:00:00Z',
      secretUpdatedAt: '2026-01-01T00:00:00Z',
    });
    const w = computeWarnings([s], settings(), NOW);
    expect(w).toHaveLength(2);
    expect(w.map((x) => x.type).sort()).toEqual(['long_connection', 'rotation_due']);
  });
});
