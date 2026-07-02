/**
 * フルチェーン e2e: Claude 相当の Client → stdio → note-bridge（子プロセス）→ HTTP → note MCP ホスト → note-core。
 * ADR-0008 D の実行経路をまるごと検証する（Electron 部分は含まない）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteClient, type FetchLike } from '../../../../packages/note-core/src/index.js';
import { startNoteHost, type NoteHost } from '../host.js';

const COOKIES = { _note_session_v5: 'sess' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const bridgePath = fileURLToPath(new URL('./note-bridge.mjs', import.meta.url));

let host: NoteHost | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await host?.close();
  client = undefined;
  host = undefined;
});

describe('note-bridge e2e（Client→stdio→bridge→HTTP→host→note-core）', () => {
  it('bridge 経由で listTools / callTool が通る', async () => {
    const fn: FetchLike = vi.fn(async () =>
      json({ data: { notes: [{ id: '1', key: 'n1', name: '記事A', status: 'draft' }], totalCount: 1, isLastPage: true } }),
    );
    host = await startNoteHost(new NoteClient({ getCookies: () => COOKIES, fetchFn: fn }));

    const transport = new StdioClientTransport({
      command: process.execPath, // 現在の node 実行ファイル
      args: [bridgePath],
      env: { ...getDefaultEnvironment(), NOTE_BRIDGE_URL: host.url, NOTE_BRIDGE_TOKEN: host.token },
    });
    client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);

    const res = (await client.callTool({ name: 'note_list_articles', arguments: {} })) as {
      content: Array<{ text: string }>;
    };
    expect(res.content[0]?.text).toContain('[下書き] 記事A');
  }, 20000);
});
