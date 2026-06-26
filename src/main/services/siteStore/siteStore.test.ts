/**
 * siteStore ゴールデンテスト（§6.1 / §5.1.1）。永続化・id・時計を注入。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SiteStore, type SiteStoreBackend } from './siteStore.js';
import { DEFAULT_MCP_ENDPOINT, type SiteRecord } from '../../../shared/domain.js';
import type { SiteInput } from '../../../shared/ipc.js';

class MemoryBackend implements SiteStoreBackend {
  records: SiteRecord[] = [];
  read() {
    return [...this.records];
  }
  write(records: SiteRecord[]) {
    this.records = [...records];
  }
}

let backend: MemoryBackend;
let idSeq: number;
let clock: Date;
let store: SiteStore;

beforeEach(() => {
  backend = new MemoryBackend();
  idSeq = 0;
  clock = new Date('2026-06-25T00:00:00Z');
  store = new SiteStore(
    backend,
    () => `id-${++idSeq}`,
    () => clock,
  );
});

function input(overrides: Partial<SiteInput> = {}): SiteInput {
  return {
    name: 'メインブログ',
    url: 'https://example.com',
    authMethod: 'application_password',
    username: 'editor',
    ...overrides,
  };
}

describe('create', () => {
  it('id・order・タイムスタンプ・既定値を付与する', () => {
    const res = store.create(input());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.record).toMatchObject({
      id: 'id-1',
      name: 'メインブログ',
      url: 'https://example.com',
      mcpEndpoint: DEFAULT_MCP_ENDPOINT,
      memo: '',
      order: 0,
      enabled: false,
      connectedAt: null,
      secretUpdatedAt: null,
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    });
  });

  it('表示名をトリムし、URL の末尾スラッシュを除去する', () => {
    const res = store.create(input({ name: '  会社サイト  ', url: 'https://corp.example.com///' }));
    if (!res.ok) throw new Error('unreachable');
    expect(res.record.name).toBe('会社サイト');
    expect(res.record.url).toBe('https://corp.example.com');
  });

  it('order は追加順に採番される', () => {
    store.create(input({ name: 'A' }));
    const b = store.create(input({ name: 'B' }));
    if (!b.ok) throw new Error('unreachable');
    expect(b.record.order).toBe(1);
  });

  it('表示名が重複（トリム後一致）したら duplicate_name で弾き、保存しない', () => {
    store.create(input({ name: 'メインブログ' }));
    const dup = store.create(input({ name: '  メインブログ  ' }));
    expect(dup).toEqual({ ok: false, reason: 'duplicate_name' });
    expect(backend.records).toHaveLength(1);
  });

  it('mcpEndpoint を指定すればそれを使う', () => {
    const res = store.create(input({ mcpEndpoint: '/wp-json/mcp/custom' }));
    if (!res.ok) throw new Error('unreachable');
    expect(res.record.mcpEndpoint).toBe('/wp-json/mcp/custom');
  });
});

describe('list', () => {
  it('order 昇順で返す', () => {
    store.create(input({ name: 'A' })); // order 0
    store.create(input({ name: 'B' })); // order 1
    store.reorder(['id-2', 'id-1']); // B, A
    expect(store.list().map((r) => r.name)).toEqual(['B', 'A']);
  });
});

describe('update', () => {
  beforeEach(() => {
    store.create(input({ name: 'メインブログ' })); // id-1
    store.create(input({ name: '会社サイト' })); // id-2
  });

  it('フィールドを更新し updatedAt を進め、createdAt と id は保つ', () => {
    clock = new Date('2026-07-01T00:00:00Z');
    const res = store.update('id-1', input({ name: 'メインブログ', memo: '更新' }));
    if (!res.ok) throw new Error('unreachable');
    expect(res.record.memo).toBe('更新');
    expect(res.record.updatedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(res.record.createdAt).toBe('2026-06-25T00:00:00.000Z');
    expect(res.record.id).toBe('id-1');
  });

  it('自分自身の名前へ更新（実質変更なし）は許可する', () => {
    const res = store.update('id-1', input({ name: 'メインブログ' }));
    expect(res.ok).toBe(true);
  });

  it('他サイトと同名へ更新しようとしたら duplicate_name', () => {
    const res = store.update('id-1', input({ name: '会社サイト' }));
    expect(res).toEqual({ ok: false, reason: 'duplicate_name' });
  });

  it('存在しない id は not_found', () => {
    expect(store.update('missing', input())).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('remove / reorder', () => {
  beforeEach(() => {
    store.create(input({ name: 'A' }));
    store.create(input({ name: 'B' }));
    store.create(input({ name: 'C' }));
  });

  it('remove は該当サイトのみ削除する', () => {
    store.remove('id-2');
    expect(store.list().map((r) => r.name)).toEqual(['A', 'C']);
  });

  it('reorder は指定順に order を振り直す', () => {
    store.reorder(['id-3', 'id-1', 'id-2']);
    expect(store.list().map((r) => r.id)).toEqual(['id-3', 'id-1', 'id-2']);
  });
});

describe('接続状態と認証情報更新の永続化', () => {
  beforeEach(() => {
    store.create(input({ name: 'メインブログ' })); // id-1
  });

  it('setConnectionState で enabled と connectedAt を更新する', () => {
    clock = new Date('2026-06-26T09:00:00Z');
    const r = store.setConnectionState('id-1', true, '2026-06-26T09:00:00.000Z');
    expect(r).toMatchObject({ enabled: true, connectedAt: '2026-06-26T09:00:00.000Z' });
    expect(store.get('id-1')!.enabled).toBe(true);
  });

  it('markSecretUpdated で secretUpdatedAt を現在時刻にする', () => {
    clock = new Date('2026-06-26T09:00:00Z');
    const r = store.markSecretUpdated('id-1');
    expect(r!.secretUpdatedAt).toBe('2026-06-26T09:00:00.000Z');
  });

  it('存在しない id への patch は undefined', () => {
    expect(store.markSecretUpdated('missing')).toBeUndefined();
  });
});
