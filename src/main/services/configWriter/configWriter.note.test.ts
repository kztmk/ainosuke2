/**
 * configWriter の note 分岐（connectNote）テスト。ADR-0008 D:
 * config には localhost URL＋Bearer トークンのみ（note 認証情報は載らない）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ConfigWriter,
  MANAGER_ID_ENV,
  NOTE_BRIDGE_TOKEN_ENV,
  NOTE_BRIDGE_URL_ENV,
  type ClaudeConfig,
  type NoteConnectionInput,
} from './configWriter.js';

let dir: string;
let configPath: string;
let writer: ConfigWriter;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpmcp-note-'));
  configPath = path.join(dir, 'claude_desktop_config.json');
  writer = new ConfigWriter(configPath);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const read = async (): Promise<ClaudeConfig> => JSON.parse(await fs.readFile(configPath, 'utf8'));

const input = (over: Partial<NoteConnectionInput> = {}): NoteConnectionInput => ({
  managerId: 'mgr-1',
  displayName: 'note: ぶんご',
  bridgePath: '/app/resources/note-bridge.mjs',
  bridgeUrl: 'http://127.0.0.1:51234/mcp',
  bridgeToken: 'tok-abc',
  ...over,
});

describe('connectNote', () => {
  it('bridge エントリを書く（url＋token のみ・秘密なし）', async () => {
    expect(await writer.connectNote(input())).toEqual({ ok: true });
    const cfg = await read();
    const entry = cfg.mcpServers!['note: ぶんご'];
    expect(entry).toEqual({
      command: 'node',
      args: ['/app/resources/note-bridge.mjs'],
      env: {
        [NOTE_BRIDGE_URL_ENV]: 'http://127.0.0.1:51234/mcp',
        [NOTE_BRIDGE_TOKEN_ENV]: 'tok-abc',
        [MANAGER_ID_ENV]: 'mgr-1',
      },
    });
    // note の Cookie 等の秘密が config に出ていない
    expect(JSON.stringify(cfg)).not.toContain('_note_session');
  });

  it('nodePath を指定できる', async () => {
    await writer.connectNote(input({ nodePath: '/usr/local/bin/node' }));
    expect((await read()).mcpServers!['note: ぶんご']!.command).toBe('/usr/local/bin/node');
  });

  it('extraEnv（ELECTRON_RUN_AS_NODE 等）を env に合流する', async () => {
    await writer.connectNote(input({ nodePath: '/app/Electron', extraEnv: { ELECTRON_RUN_AS_NODE: '1' } }));
    const entry = (await read()).mcpServers!['note: ぶんご']!;
    expect(entry.command).toBe('/app/Electron');
    expect(entry.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      [NOTE_BRIDGE_URL_ENV]: 'http://127.0.0.1:51234/mcp',
      [MANAGER_ID_ENV]: 'mgr-1',
    });
  });

  it('同一 managerId への再接続は冪等更新（URL/token を差し替え）', async () => {
    await writer.connectNote(input());
    await writer.connectNote(input({ bridgeUrl: 'http://127.0.0.1:60000/mcp', bridgeToken: 'tok-new' }));
    const cfg = await read();
    expect(Object.keys(cfg.mcpServers!)).toHaveLength(1);
    expect(cfg.mcpServers!['note: ぶんご']!.env[NOTE_BRIDGE_URL_ENV]).toBe('http://127.0.0.1:60000/mcp');
    expect(cfg.mcpServers!['note: ぶんご']!.env[NOTE_BRIDGE_TOKEN_ENV]).toBe('tok-new');
  });

  it('表示名変更は旧キーを削除して改名する', async () => {
    await writer.connectNote(input());
    await writer.connectNote(input({ displayName: 'note: 改名後' }));
    const cfg = await read();
    expect(Object.keys(cfg.mcpServers!)).toEqual(['note: 改名後']);
  });

  it('disconnect(managerId) で note エントリを削除できる（WordPress と共通経路）', async () => {
    await writer.connectNote(input());
    expect(await writer.disconnect('mgr-1')).toEqual({ ok: true });
    expect((await read()).mcpServers).toEqual({});
  });

  it('他アプリの同名キーとは衝突ブロック', async () => {
    await fs.writeFile(
      configPath,
      JSON.stringify({ mcpServers: { 'note: ぶんご': { command: 'x', args: [], env: {} } } }),
    );
    const r = await writer.connectNote(input());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('key_collision');
  });
});
