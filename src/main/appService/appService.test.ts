/**
 * AppService 統合テスト — 実サービスをフェイク依存で組み合わせ、多段フロー（接続・削除・同期）を検証。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { AppService, type SettingsStore } from './appService.js';
import { ConfigWriter, MANAGER_ID_ENV } from '../services/configWriter/configWriter.js';
import { SiteStore, type SiteStoreBackend } from '../services/siteStore/siteStore.js';
import {
  SecretStore,
  type KeyValueStore,
  type SafeStorageLike,
} from '../services/secretStore/secretStore.js';
import { WpClient, type FetchLike } from '../services/wpClient/wpClient.js';
import { McpClient } from '../services/mcpClient/mcpClient.js';
import { EntitlementService } from '../services/entitlement/entitlement.js';
import { ClaudeDesktopService } from '../services/claudeDesktop/claudeDesktop.js';
import { Logger, type LogEntry, type LogStore } from '../services/logger/logger.js';
import { DEFAULT_SETTINGS, type AppSettings, type SiteRecord } from '../../shared/domain.js';
import type { SiteInput } from '../../shared/ipc.js';

// --- フェイク群 -----------------------------------------------------------

class MemoryBackend implements SiteStoreBackend {
  records: SiteRecord[] = [];
  read() {
    return [...this.records];
  }
  write(r: SiteRecord[]) {
    this.records = [...r];
  }
}
class InMemoryKv implements KeyValueStore {
  m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k);
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  delete(k: string) {
    this.m.delete(k);
  }
}
class FakeSafe implements SafeStorageLike {
  available = true;
  isEncryptionAvailable() {
    return this.available;
  }
  encryptString(s: string) {
    return Buffer.from(JSON.stringify({ v: s }), 'utf8');
  }
  decryptString(b: Buffer) {
    return (JSON.parse(b.toString('utf8')) as { v: string }).v;
  }
}
class MemoryLogStore implements LogStore {
  entries: LogEntry[] = [];
  read() {
    return [...this.entries];
  }
  write(e: LogEntry[]) {
    this.entries = [...e];
  }
}
class MemorySettings implements SettingsStore {
  current: AppSettings = { ...DEFAULT_SETTINGS };
  read() {
    return this.current;
  }
  write(s: AppSettings) {
    this.current = s;
  }
}

function routerFetch(): FetchLike {
  return vi.fn(async (url: string) => {
    if (url.includes('/wp-json/wp/v2/posts')) {
      const total = url.includes('status=draft') ? '3' : '142';
      return new Response('[]', { status: 200, headers: { 'X-WP-Total': total } });
    }
    if (url.includes('/wp-json/mcp/')) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: '2025-06-18', serverInfo: { name: 'mcp-adapter', version: 'v1.2' }, capabilities: {} },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  });
}

// --- ハーネス -------------------------------------------------------------

interface Harness {
  app: AppService;
  configPath: string;
  safe: FakeSafe;
  settings: MemorySettings;
  procCalls: string[];
  emit: ReturnType<typeof vi.fn>;
  setNow: (d: Date) => void;
}

let dir: string;

async function makeApp(fetchFn: FetchLike = routerFetch()): Promise<Harness> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpmcp-app-'));
  const configPath = path.join(dir, 'claude_desktop_config.json');
  let idSeq = 0;
  let now = new Date('2026-06-25T00:00:00Z');
  const clock = () => now;

  const safe = new FakeSafe();
  const settings = new MemorySettings();
  const procCalls: string[] = [];
  const emit = vi.fn();

  const app = new AppService({
    sites: new SiteStore(new MemoryBackend(), () => `id-${++idSeq}`, clock),
    secrets: new SecretStore(new InMemoryKv(), safe),
    config: new ConfigWriter(configPath),
    wp: new WpClient(fetchFn),
    mcp: new McpClient(fetchFn),
    entitlement: new EntitlementService({ tier: 'free', enforcementEnabled: false }),
    claude: new ClaudeDesktopService({
      platform: 'darwin',
      env: {},
      homedir: '/Users/alice',
      pathExists: () => true,
      process: {
        quit: async () => {
          procCalls.push('quit');
        },
        launch: async () => {
          procCalls.push('launch');
        },
      },
    }),
    logger: new Logger(new MemoryLogStore(), clock),
    settings,
    openExternal: vi.fn(async () => {}),
    emitSiteStatus: emit,
    now: clock,
  });

  return { app, configPath, safe, settings, procCalls, emit, setNow: (d) => (now = d) };
}

const INPUT: SiteInput = {
  name: 'メインブログ',
  url: 'https://example.com',
  authMethod: 'application_password',
  username: 'editor',
};

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function readConfig(p: string) {
  return JSON.parse(await fs.readFile(p, 'utf8')) as {
    mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
  };
}

// --- テスト ---------------------------------------------------------------

describe('sites: 作成と DTO 組み立て', () => {
  it('作成直後は hasSecret=false / connection=saved / health=unverified', async () => {
    const { app } = await makeApp();
    const res = app.sitesCreate(INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.site).toMatchObject({
      name: 'メインブログ',
      hasSecret: false,
      connection: 'saved',
      health: 'unverified',
      summary: null,
    });
  });

  it('表示名重複は duplicate_name を返す', async () => {
    const { app } = await makeApp();
    app.sitesCreate(INPUT);
    expect(app.sitesCreate(INPUT)).toEqual({
      ok: false,
      reason: 'duplicate_name',
      message: expect.any(String),
    });
  });
});

describe('secret: 保存で hasSecret と secretUpdatedAt が立つ', () => {
  it('secretSet 後に hasSecret=true、secretUpdatedAt が記録される', async () => {
    const { app } = await makeApp();
    const created = app.sitesCreate(INPUT);
    if (!created.ok) return;
    const id = created.site.id;

    expect(app.secretSet(id, 'app pass')).toEqual({ ok: true });
    const site = app.sitesGet(id)!;
    expect(site.hasSecret).toBe(true);
    expect(site.secretUpdatedAt).toBe('2026-06-25T00:00:00.000Z');
  });
});

describe('connection: 接続フロー（秘密→config→状態）', () => {
  it('秘密未保存では secret_missing で config を書かない', async () => {
    const { app, configPath } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;

    const res = await app.connectionOn(c.site.id);
    expect(res).toMatchObject({ ok: false, reason: 'secret_missing' });
    await expect(fs.access(configPath)).rejects.toThrow();
  });

  it('秘密ありで接続すると config に WP_MCP_MANAGER_ID と固定バージョンが書かれ、再起動待ちになる', async () => {
    const { app, configPath } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    const id = c.site.id;
    app.secretSet(id, 'app pass');

    const res = await app.connectionOn(id);
    expect(res).toEqual({ ok: true });

    const cfg = await readConfig(configPath);
    const entry = cfg.mcpServers['メインブログ']!;
    expect(entry.env[MANAGER_ID_ENV]).toBe(id);
    expect(entry.env.WP_API_URL).toBe('https://example.com/wp-json/mcp/mcp-adapter-default-server');
    expect(entry.args[1]).toBe('@automattic/mcp-wordpress-remote@0.3.5');

    const site = app.sitesGet(id)!;
    expect(site.enabled).toBe(true);
    expect(site.connection).toBe('connected_pending_restart');
  });

  it('再起動すると connected_active になり、quit→launch が呼ばれる', async () => {
    const { app, procCalls } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    const id = c.site.id;
    app.secretSet(id, 'app pass');
    await app.connectionOn(id);

    await app.claudeRestart();
    expect(procCalls).toEqual(['quit', 'launch']);
    expect(app.sitesGet(id)!.connection).toBe('connected_active');
  });

  it('接続解除で config からエントリが消え、saved に戻る', async () => {
    const { app, configPath } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    const id = c.site.id;
    app.secretSet(id, 'app pass');
    await app.connectionOn(id);

    const res = await app.connectionOff(id);
    expect(res).toEqual({ ok: true });
    const cfg = await readConfig(configPath);
    expect(cfg.mcpServers['メインブログ']).toBeUndefined();
    expect(app.sitesGet(id)!.connection).toBe('saved');
  });

  it('表示名が他アプリの既存キーと衝突したら key_collision', async () => {
    const { app, configPath } = await makeApp();
    await fs.writeFile(
      configPath,
      JSON.stringify({ mcpServers: { 'メインブログ': { command: 'npx', args: [], env: {} } } }),
      'utf8',
    );
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    app.secretSet(c.site.id, 'app pass');

    const res = await app.connectionOn(c.site.id);
    expect(res).toMatchObject({ ok: false, reason: 'key_collision' });
  });
});

describe('sites: 削除は config・秘密・レコードを一掃する', () => {
  it('接続中サイトを削除すると config エントリ・秘密・レコードが消える', async () => {
    const { app, configPath } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    const id = c.site.id;
    app.secretSet(id, 'app pass');
    await app.connectionOn(id);

    await app.sitesRemove(id);

    expect(app.sitesList()).toHaveLength(0);
    expect(app.secretHas(id)).toBe(false);
    const cfg = await readConfig(configPath);
    expect(cfg.mcpServers['メインブログ']).toBeUndefined();
  });
});

describe('test / sync: サマリーとステータスを反映', () => {
  it('testRun 成功で health=ok、MCP バージョンがキャッシュされる', async () => {
    const { app } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    const id = c.site.id;
    app.secretSet(id, 'app pass');

    const result = await app.testRun({ kind: 'site', siteId: id });
    expect(result.rest).toMatchObject({ ok: true, publishedCount: 142 });
    expect(result.mcp).toMatchObject({ ok: true, serverVersion: 'v1.2' });

    const site = app.sitesGet(id)!;
    expect(site.health).toBe('ok');
    expect(site.summary?.mcpAdapterVersion).toBe('v1.2');
  });

  it('syncRun は投稿数・下書き数・バージョンを取得して Site を返す', async () => {
    const { app } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    const id = c.site.id;
    app.secretSet(id, 'app pass');

    const site = await app.syncRun(id);
    expect(site.summary).toEqual({
      publishedCount: 142,
      draftCount: 3,
      mcpAdapterVersion: 'v1.2',
      mcpEndpointReachable: true,
    });
    expect(site.health).toBe('ok');
  });
});

describe('Phase 2: 全サイト更新・ステータスイベント', () => {
  it('refreshAllStatuses が全サイトを更新し、サイトごとに emit する', async () => {
    const { app, emit } = await makeApp();
    const a = app.sitesCreate({ ...INPUT, name: 'A' });
    const b = app.sitesCreate({ ...INPUT, name: 'B' });
    if (!a.ok || !b.ok) return;
    app.secretSet(a.site.id, 'pw');
    app.secretSet(b.site.id, 'pw');
    emit.mockClear();

    const updated = await app.refreshAllStatuses();
    expect(updated).toHaveLength(2);
    expect(updated.every((s) => s.health === 'ok')).toBe(true);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('接続・同期でも emit される', async () => {
    const { app, emit } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    app.secretSet(c.site.id, 'pw');
    emit.mockClear();

    await app.connectionOn(c.site.id);
    await app.syncRun(c.site.id);
    expect(emit.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Phase 2: 警告と CSV', () => {
  it('90 日超のローテーション警告を返す（Free）', async () => {
    const { app, setNow } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    app.secretSet(c.site.id, 'pw'); // secretUpdatedAt = 2026-06-25
    setNow(new Date('2026-10-01T00:00:00Z')); // 98 日後

    const w = app.getWarnings();
    expect(w).toContainEqual({ siteId: c.site.id, type: 'rotation_due' });
  });

  it('enforcement OFF では 24h 接続継続警告も得られる', async () => {
    const { app, setNow } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;
    app.secretSet(c.site.id, 'pw');
    await app.connectionOn(c.site.id); // connectedAt = 2026-06-25
    setNow(new Date('2026-06-27T00:00:00Z')); // 48h 後

    const w = app.getWarnings();
    expect(w.some((x) => x.type === 'long_connection')).toBe(true);
  });

  it('exportLogsCsv はヘッダ付き CSV を返す（enforcement OFF＝Pro 相当）', async () => {
    const { app } = await makeApp();
    const c = app.sitesCreate(INPUT);
    if (!c.ok) return;

    const csv = app.exportLogsCsv();
    expect(csv).not.toBeNull();
    expect(csv!.split('\n')[0]).toBe('at,type,siteId,result,message');
    expect(csv).toContain('site.add');
  });

  it('enforcement ON + Free では CSV エクスポートは null', async () => {
    const { app } = await makeApp();
    // Free で強制 ON にすると Pro 機能はブロックされる
    (app as unknown as { d: { entitlement: EntitlementService } }).d.entitlement.setState({
      tier: 'free',
      enforcementEnabled: true,
    });
    expect(app.exportLogsCsv()).toBeNull();
  });
});

describe('entitlement / settings の委譲', () => {
  it('enforcement OFF では上限が無制限', async () => {
    const { app } = await makeApp();
    expect(app.entitlementSiteLimit()).toBe(Infinity);
    expect(app.entitlementCan('monitor.background')).toBe(true);
  });

  it('settingsUpdate は patch をマージして永続化する', async () => {
    const { app } = await makeApp();
    const next = app.settingsUpdate({ theme: 'dark' });
    expect(next.theme).toBe('dark');
    expect(app.settingsGet().theme).toBe('dark');
  });
});
