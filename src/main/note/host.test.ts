/**
 * note MCP ホスト（localhost Streamable HTTP）の統合テスト。
 * 実 HTTP クライアント（StreamableHTTPClientTransport）で接続し、Bearer 認証・listTools・callTool を検証。
 * Electron 非依存（Node http のみ）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteClient, type FetchLike } from '../../../packages/note-core/src/index.js';
import { startNoteHost, type NoteHost } from './host.js';

const COOKIES = { _note_session_v5: 'sess' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

let host: NoteHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

async function connectClient(h: NoteHost, token = h.token) {
  const transport = new StreamableHTTPClientTransport(new URL(h.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

describe('startNoteHost', () => {
  it('localhost に起動し、url/token/port を返す', async () => {
    host = await startNoteHost(new NoteClient({ getCookies: () => COOKIES, fetchFn: vi.fn(async () => json({})) }));
    expect(host.port).toBeGreaterThan(0);
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(host.token).toMatch(/[0-9a-f-]{36}/);
  });

  it('Bearer トークンで接続し、6ツールを listTools できる', async () => {
    host = await startNoteHost(new NoteClient({ getCookies: () => COOKIES, fetchFn: vi.fn(async () => json({})) }));
    const client = await connectClient(host);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('note_create_draft');
    expect(tools).toHaveLength(6);
    await client.close();
  });

  it('callTool が note セッション経由で実データを返す', async () => {
    const fn: FetchLike = vi.fn(async () =>
      json({ data: { notes: [{ id: '1', key: 'n1', name: '記事A', status: 'published' }], totalCount: 1, isLastPage: true } }),
    );
    host = await startNoteHost(new NoteClient({ getCookies: () => COOKIES, fetchFn: fn }));
    const client = await connectClient(host);
    const res = (await client.callTool({ name: 'note_list_articles', arguments: {} })) as {
      content: Array<{ text: string }>;
    };
    expect(res.content[0]?.text).toContain('[公開済み] 記事A');
    await client.close();
  });

  it('トークン無し/不一致は 401 で拒否する', async () => {
    host = await startNoteHost(new NoteClient({ getCookies: () => COOKIES, fetchFn: vi.fn(async () => json({})) }));
    const noAuth = await fetch(host.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(noAuth.status).toBe(401);

    const wrong = await fetch(host.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(wrong.status).toBe(401);
  });
});
