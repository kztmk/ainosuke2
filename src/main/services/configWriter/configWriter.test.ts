/**
 * configWriter ゴールデンテスト。
 * 仕様 v1.2 §5.2.1 / ADR-0001 / ADR-0005 の不変条件を固定する。
 * 各テストは実ファイル（一時ディレクトリ）に対して実行する。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ConfigWriter,
  MANAGER_ID_ENV,
  REMOTE_PACKAGE,
  type ClaudeConfig,
  type SiteConnectionInput,
} from './configWriter.js';

let dir: string;
let configPath: string;
let writer: ConfigWriter;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpmcp-cfg-'));
  configPath = path.join(dir, 'claude_desktop_config.json');
  writer = new ConfigWriter(configPath);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// --- helpers -------------------------------------------------------------

function site(overrides: Partial<SiteConnectionInput> = {}): SiteConnectionInput {
  return {
    managerId: 'id-main',
    displayName: 'メインブログ',
    apiUrl: 'https://example.com/wp-json/mcp/mcp-adapter-default-server',
    username: 'editor-user',
    applicationPassword: 'xxxx xxxx xxxx xxxx',
    pinnedVersion: '0.3.5',
    ...overrides,
  };
}

async function readJson(p: string): Promise<ClaudeConfig> {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.writeFile(p, JSON.stringify(value, null, 2), 'utf8');
}

function foreignEntry(id = 'someone-else') {
  return {
    command: 'npx',
    args: ['-y', 'some-other-mcp-server'],
    env: { SOME_TOKEN: id },
  };
}

// --- 1. 新規作成 ----------------------------------------------------------

describe('connect: 新規作成', () => {
  it('ファイル不在時は { mcpServers: {...} } を新規作成する', async () => {
    const res = await writer.connect(site());
    expect(res).toEqual({ ok: true });

    const cfg = await readJson(configPath);
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual(['メインブログ']);
  });

  it('新規作成時は .bak を作らない（退避すべき既存が無い）', async () => {
    await writer.connect(site());
    await expect(fs.access(`${configPath}.bak`)).rejects.toThrow();
  });

  it('エントリは npx・完全固定バージョン・OAUTH_ENABLED=false・WP_MCP_MANAGER_ID を含む', async () => {
    await writer.connect(site());
    const cfg = await readJson(configPath);
    const entry = cfg.mcpServers!['メインブログ']!;

    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['-y', `${REMOTE_PACKAGE}@0.3.5`]);
    expect(entry.env.OAUTH_ENABLED).toBe('false');
    expect(entry.env[MANAGER_ID_ENV]).toBe('id-main');
    expect(entry.env.WP_API_URL).toBe(site().apiUrl);
    expect(entry.env.WP_API_USERNAME).toBe('editor-user');
    expect(entry.env.WP_API_PASSWORD).toBe('xxxx xxxx xxxx xxxx');
    // バージョン範囲指定（^ / ~）になっていないこと
    expect(entry.args[1]).not.toMatch(/[\^~]/);
  });
});

// --- 2. 他アプリ設定の保持 -----------------------------------------------

describe('connect: 他アプリ設定の保持', () => {
  it('他の mcpServers エントリとトップレベルキーを保持したまま追加する', async () => {
    await writeJson(configPath, {
      globalShortcut: 'Cmd+Shift+Space',
      mcpServers: { 'other-tool': foreignEntry() },
    });

    const res = await writer.connect(site());
    expect(res.ok).toBe(true);

    const cfg = await readJson(configPath);
    expect(cfg.globalShortcut).toBe('Cmd+Shift+Space');
    expect(cfg.mcpServers!['other-tool']).toEqual(foreignEntry());
    expect(cfg.mcpServers!['メインブログ']).toBeDefined();
  });
});

// --- 3. 破損 JSON で中断 --------------------------------------------------

describe('破損 JSON の保護', () => {
  it('パース不能なら上書きせず parse_error で中断する', async () => {
    const broken = '{ this is not json ';
    await fs.writeFile(configPath, broken, 'utf8');

    const res = await writer.connect(site());
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toBe('parse_error');

    // ファイルは一切変更されていない
    expect(await fs.readFile(configPath, 'utf8')).toBe(broken);
    await expect(fs.access(`${configPath}.bak`)).rejects.toThrow();
  });

  it('トップレベルが配列でも corrupt 扱いで中断する', async () => {
    await writeJson(configPath, [1, 2, 3]);
    const res = await writer.connect(site());
    expect(res.ok).toBe(false);
  });
});

// --- 4. キー衝突のブロック -----------------------------------------------

describe('キー衝突', () => {
  it('同名キーが他アプリのものなら接続をブロックし、ファイルを変更しない', async () => {
    await writeJson(configPath, {
      mcpServers: { 'メインブログ': foreignEntry() },
    });
    const before = await fs.readFile(configPath, 'utf8');

    const res = await writer.connect(site());
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toBe('key_collision');

    expect(await fs.readFile(configPath, 'utf8')).toBe(before);
  });

  it('同名キーが自社（同一 managerId）なら衝突ではなく冪等更新になる', async () => {
    await writer.connect(site());
    const res = await writer.connect(site({ username: 'editor-2' }));
    expect(res.ok).toBe(true);

    const cfg = await readJson(configPath);
    expect(cfg.mcpServers!['メインブログ']!.env.WP_API_USERNAME).toBe('editor-2');
  });
});

// --- 5. 改名（旧キー削除＋新キー追加） ------------------------------------

describe('改名', () => {
  it('接続中サイトの改名は旧キー削除＋新キー追加として処理する', async () => {
    await writer.connect(site({ displayName: '旧名' }));

    const res = await writer.updateConnected(site({ displayName: '新名' }));
    expect(res.ok).toBe(true);

    const cfg = await readJson(configPath);
    expect(cfg.mcpServers!['旧名']).toBeUndefined();
    expect(cfg.mcpServers!['新名']).toBeDefined();
    expect(cfg.mcpServers!['新名']!.env[MANAGER_ID_ENV]).toBe('id-main');
  });

  it('改名時に他アプリのエントリは触らない', async () => {
    await writeJson(configPath, { mcpServers: { 'other-tool': foreignEntry() } });
    await writer.connect(site({ displayName: '旧名' }));
    await writer.updateConnected(site({ displayName: '新名' }));

    const cfg = await readJson(configPath);
    expect(cfg.mcpServers!['other-tool']).toEqual(foreignEntry());
  });
});

// --- 6. disconnect はマーカーで特定 --------------------------------------

describe('disconnect', () => {
  it('env.WP_MCP_MANAGER_ID で自社エントリのみ削除し、他は保持する', async () => {
    await writeJson(configPath, { mcpServers: { 'other-tool': foreignEntry() } });
    await writer.connect(site());

    const res = await writer.disconnect('id-main');
    expect(res.ok).toBe(true);

    const cfg = await readJson(configPath);
    expect(cfg.mcpServers!['メインブログ']).toBeUndefined();
    expect(cfg.mcpServers!['other-tool']).toEqual(foreignEntry());
  });

  it('表示名が手動で変えられていてもマーカーで特定して削除できる', async () => {
    await writer.connect(site());
    // 第三者がキー名だけ書き換えた状況を模倣（env マーカーは残る）
    const cfg = await readJson(configPath);
    cfg.mcpServers!['手で改名されたキー'] = cfg.mcpServers!['メインブログ']!;
    delete cfg.mcpServers!['メインブログ'];
    await writeJson(configPath, cfg);

    await writer.disconnect('id-main');
    const after = await readJson(configPath);
    expect(Object.keys(after.mcpServers ?? {})).toEqual([]);
  });

  it('ファイル不在でもエラーにならない（冪等）', async () => {
    expect(await writer.disconnect('id-main')).toEqual({ ok: true });
  });
});

// --- 7. アトミック書き込み＋.bak -----------------------------------------

describe('アトミック書き込み', () => {
  it('既存ファイルへの書き込みは直前の内容を .bak に退避する', async () => {
    await writeJson(configPath, { mcpServers: { 'other-tool': foreignEntry() } });
    const before = await fs.readFile(configPath, 'utf8');

    await writer.connect(site());

    const bak = await fs.readFile(`${configPath}.bak`, 'utf8');
    expect(bak).toBe(before);

    const after = await readJson(configPath);
    expect(after.mcpServers!['メインブログ']).toBeDefined();
  });

  it('書き込み後に一時ファイル（.tmp-*）が残らない', async () => {
    await writer.connect(site());
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.includes('.tmp-'))).toBe(false);
  });
});

// --- 8. removeAllOwned（アンインストール・ADR-0005） ----------------------

describe('removeAllOwned', () => {
  it('自社エントリを全削除し、他アプリのエントリは保持する', async () => {
    await writeJson(configPath, { mcpServers: { 'other-tool': foreignEntry() } });
    await writer.connect(site({ managerId: 'id-a', displayName: 'サイトA' }));
    await writer.connect(site({ managerId: 'id-b', displayName: 'サイトB' }));

    const res = await writer.removeAllOwned();
    expect(res.ok).toBe(true);

    const cfg = await readJson(configPath);
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual(['other-tool']);
  });

  it('破損ファイルなら削除せず parse_error で中断する', async () => {
    await fs.writeFile(configPath, 'not json', 'utf8');
    const res = await writer.removeAllOwned();
    expect(res.ok).toBe(false);
  });
});
