/**
 * mcpClient ゴールデンテスト（§5.3.1 / 未決#4）。fetch を注入。
 */
import { describe, expect, it, vi } from 'vitest';
import { McpClient } from './mcpClient.js';
import type { FetchLike } from '../wpClient/wpClient.js';

const OPTS = {
  endpointUrl: 'https://example.com/wp-json/mcp/mcp-adapter-default-server',
  auth: { username: 'editor', applicationPassword: 'app pass word' },
};

function rpcOk(version = 'v1.2', protocolVersion = '2025-06-18') {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion,
      serverInfo: { name: 'mcp-adapter', version: version },
      capabilities: {},
    },
  });
}

function fakeFetch(responder: (url: string, init?: RequestInit) => Response): FetchLike {
  return vi.fn(async (url: string, init?: RequestInit) => responder(url, init));
}

describe('initialize: 成功（JSON 応答）', () => {
  it('serverInfo.version を MCP アダプターバージョンとして取り出す', async () => {
    const client = new McpClient(
      fakeFetch(() => new Response(rpcOk('v1.2'), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    const res = await client.initialize(OPTS);
    expect(res).toEqual({
      ok: true,
      serverName: 'mcp-adapter',
      serverVersion: 'v1.2',
      protocolVersion: '2025-06-18',
    });
  });

  it('POST・Basic 認証・Accept に JSON と SSE 両方を含む', async () => {
    const fetchFn = fakeFetch(() =>
      new Response(rpcOk(), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new McpClient(fetchFn);
    await client.initialize(OPTS);

    const expectedAuth = 'Basic ' + Buffer.from('editor:app pass word').toString('base64');
    expect(fetchFn).toHaveBeenCalledWith(
      OPTS.endpointUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: expectedAuth,
        }),
      }),
    );
    // body は initialize メソッド
    const init = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!;
    const parsed = JSON.parse(init.body as string);
    expect(parsed.method).toBe('initialize');
    expect(parsed.params.protocolVersion).toBe('2025-06-18');
  });
});

describe('initialize: SSE 応答', () => {
  it('text/event-stream の data: 行から JSON-RPC を取り出す', async () => {
    const sse = `event: message\ndata: ${rpcOk('v9.9')}\n\n`;
    const client = new McpClient(
      fakeFetch(() => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })),
    );
    const res = await client.initialize(OPTS);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.serverVersion).toBe('v9.9');
  });
});

describe('initialize: 版ネゴシエーション', () => {
  it('最初の版が JSON-RPC エラーなら次の版へフォールバックして成功する', async () => {
    const attempts: string[] = [];
    const client = new McpClient(
      fakeFetch((_url, init) => {
        const parsed = JSON.parse((init!.body as string));
        attempts.push(parsed.params.protocolVersion);
        if (parsed.params.protocolVersion === '2025-06-18') {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unsupported protocol version' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(rpcOk('v1.0', '2025-03-26'), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const res = await client.initialize(OPTS);
    expect(attempts).toEqual(['2025-06-18', '2025-03-26']);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.protocolVersion).toBe('2025-03-26');
  });
});

describe('initialize: 失敗系', () => {
  it('HTTP 401 は版を変えず即座に失敗を返す', async () => {
    const fetchFn = fakeFetch(() => new Response('unauthorized', { status: 401 }));
    const client = new McpClient(fetchFn);
    const res = await client.initialize(OPTS);
    expect(res).toEqual({ ok: false, status: 401, error: 'HTTP 401' });
    expect(fetchFn).toHaveBeenCalledTimes(1); // フォールバックしない
  });

  it('ネットワーク例外は error を返す', async () => {
    const client = new McpClient(
      fakeFetch(() => {
        throw new Error('ETIMEDOUT');
      }),
    );
    const res = await client.initialize(OPTS);
    expect(res).toEqual({ ok: false, error: 'ETIMEDOUT' });
  });
});
