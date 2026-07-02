/**
 * MCP プロトコル統合テスト: 実 Client ↔ createNoteMcpServer を InMemoryTransport で接続し、
 * listTools / callTool が protocol 越しに機能することを検証（SDK 登録の配線確認）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { NoteClient, type FetchLike } from '../client.js';
import { createNoteMcpServer } from './server.js';

const COOKIES = { _note_session_v5: 'sess' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

async function connect(fn: FetchLike) {
  const server = createNoteMcpServer(new NoteClient({ getCookies: () => COOKIES, fetchFn: fn }));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return { client, server };
}

describe('MCP 統合（InMemoryTransport）', () => {
  it('listTools で6ツールが公開される', async () => {
    const fn: FetchLike = vi.fn(async () => json({}));
    const { client } = await connect(fn);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'note_create_draft',
        'note_delete_draft',
        'note_get_article',
        'note_list_articles',
        'note_publish_article',
        'note_update_article',
      ].sort(),
    );
    // inputSchema が JSON Schema として公開される
    const create = tools.find((t) => t.name === 'note_create_draft');
    expect(create?.inputSchema?.properties).toHaveProperty('title');
    expect(create?.inputSchema?.properties).toHaveProperty('body');
  });

  it('callTool(note_list_articles) が protocol 越しに実データを返す', async () => {
    const fn: FetchLike = vi.fn(async () =>
      json({ data: { notes: [{ id: '1', key: 'n1', name: '記事A', status: 'published' }], totalCount: 1, isLastPage: true } }),
    );
    const { client } = await connect(fn);
    const res = (await client.callTool({ name: 'note_list_articles', arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(res.content[0]?.text).toContain('[公開済み] 記事A');
  });

  it('callTool(note_create_draft) が markdown を変換して作成する', async () => {
    let savedBody = '';
    const fn: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/text_notes')) return json({ data: { id: '3', key: 'nzzz' } }, 201);
      if (url.includes('/draft_save')) {
        savedBody = (JSON.parse(String(init?.body)) as { body: string }).body;
        return json({ data: { result: true } });
      }
      return json({}, 500);
    });
    const { client } = await connect(fn);
    const res = (await client.callTool({
      name: 'note_create_draft',
      arguments: { title: 'T', body: '# 見出し\n\n本文' },
    })) as { content: Array<{ text: string }> };
    expect(res.content[0]?.text).toContain('下書きを作成しました。ID: 3、キー: nzzz');
    expect(savedBody).toContain('<h1');
  });
});
