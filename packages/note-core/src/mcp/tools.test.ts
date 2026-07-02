/**
 * note MCP ツールのテスト。ハンドラを fake fetch の NoteClient で直接叩く
 * （tools ＋ note-core ＋ markdown 変換を通しで検証）。
 */
import { describe, expect, it, vi } from 'vitest';
import { NoteClient, type FetchLike } from '../client.js';
import { buildNoteTools } from './tools.js';
import { createNoteMcpServer } from './server.js';

const COOKIES = { _note_session_v5: 'sess', 'XSRF-TOKEN': 'x' };

function recordingFetch(responder: (method: string, url: string, body: unknown) => Response): {
  fn: FetchLike;
  calls: Array<{ method: string; url: string; body: unknown }>;
} {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fn: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    return responder(method, url, body);
  });
  return { fn, calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function tools(fn: FetchLike) {
  const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
  const map = new Map(buildNoteTools(client).map((t) => [t.name, t]));
  return map;
}
const text = (r: { content: Array<{ text: string }> }) => r.content[0]?.text ?? '';

describe('buildNoteTools / server', () => {
  it('v1 の6ツールを提供する', () => {
    const names = buildNoteTools(new NoteClient({ getCookies: () => COOKIES })).map((t) => t.name);
    expect(names).toEqual([
      'note_create_draft',
      'note_get_article',
      'note_update_article',
      'note_publish_article',
      'note_list_articles',
      'note_delete_draft',
    ]);
  });

  it('createNoteMcpServer が McpServer を返す（登録が例外なく通る）', () => {
    const server = createNoteMcpServer(new NoteClient({ getCookies: () => COOKIES }));
    expect(server).toBeDefined();
  });
});

describe('note_create_draft', () => {
  it('markdown を note HTML に変換して送り、ID/キーを返す', async () => {
    const { fn, calls } = recordingFetch((method, url) => {
      if (url.endsWith('/v1/text_notes') && method === 'POST') return json({ data: { id: '10', key: 'nabc' } }, 201);
      return json({ data: { result: true } });
    });
    const r = await tools(fn).get('note_create_draft')!.handler({ title: 'T', body: '# 見出し\n\n本文', tags: ['#x'] });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('下書きを作成しました。ID: 10、キー: nabc');
    expect(text(r)).toContain('タグ: x');
    // draft_save に渡る body は note HTML（h1 が含まれる）
    const save = calls.find((c) => c.url.includes('/draft_save'));
    expect((save?.body as { body: string }).body).toContain('<h1');
  });

  it('認証切れはアプリログインを促す', async () => {
    const r = await tools(recordingFetch(() => json({}, 401)).fn)
      .get('note_create_draft')!
      .handler({ title: 'T', body: 'x' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('アプリで note にログイン');
  });
});

describe('note_get_article', () => {
  it('本文を markdown に変換して返す', async () => {
    const html = '<h2 name="a" id="a">章</h2><p name="b" id="b">段落</p>';
    const fn = recordingFetch(() => json({ data: { id: '1', key: 'nabc', name: 'タイトル', status: 'draft', body: html } })).fn;
    const r = await tools(fn).get('note_get_article')!.handler({ article_id: 'nabc' });
    expect(text(r)).toContain('タイトル: タイトル');
    expect(text(r)).toContain('ステータス: draft');
    expect(text(r)).toContain('## 章');
    expect(text(r)).toContain('段落');
  });

  it('数値IDは invalid で取得失敗メッセージ', async () => {
    const r = await tools(recordingFetch(() => json({})).fn).get('note_get_article')!.handler({ article_id: '123' });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('記事の取得に失敗しました');
  });
});

describe('note_update_article', () => {
  it('数値IDへ解決して更新し、成功メッセージを返す', async () => {
    const { fn } = recordingFetch((method, url) => {
      if (url.endsWith('/v3/notes/nabc')) return json({ data: { id: '77', key: 'nabc' } });
      return json({ data: { result: true } });
    });
    const r = await tools(fn).get('note_update_article')!.handler({ article_id: 'nabc', title: '新', body: '本文' });
    expect(text(r)).toContain('記事を更新しました。ID: 77');
  });
});

describe('note_publish_article', () => {
  it('article_id 指定で既存下書きを公開', async () => {
    const { fn } = recordingFetch((method, url) => {
      if (url.endsWith('/v3/notes/nabc') && method === 'GET')
        return json({ data: { id: '5', key: 'nabc', name: 'T', status: 'published', note_draft: { name: 'T', body: '<p>b</p>' }, noteUrl: 'https://note.com/u/n/nabc' } });
      if (url.endsWith('/v1/text_notes/5') && method === 'PUT') return json({ data: { result: true } });
      return json({}, 500);
    });
    const r = await tools(fn).get('note_publish_article')!.handler({ article_id: 'nabc' });
    expect(text(r)).toContain('記事を公開しました。ID: 5');
    expect(text(r)).toContain('URL: https://note.com/u/n/nabc');
  });

  it('title/body 指定で新規作成して公開', async () => {
    const { fn, calls } = recordingFetch((method, url) => {
      if (url.endsWith('/v1/text_notes') && method === 'POST') return json({ data: { id: '9', key: 'nnew' } }, 201);
      if (url.includes('/draft_save')) return json({ data: { result: true } });
      if (url.endsWith('/v3/notes/nnew') && method === 'GET') return json({ data: { id: '9', key: 'nnew', name: 'T', status: 'published' } });
      if (url.endsWith('/v1/text_notes/9') && method === 'PUT') return json({ data: { result: true } });
      return json({}, 500);
    });
    const r = await tools(fn).get('note_publish_article')!.handler({ title: 'T', body: '# H\n\nb' });
    expect(text(r)).toContain('記事を公開しました。ID: 9');
    expect(calls.some((c) => c.url.endsWith('/v1/text_notes') && c.method === 'POST')).toBe(true);
  });

  it('article_id も title/body も無ければエラー', async () => {
    const r = await tools(recordingFetch(() => json({})).fn).get('note_publish_article')!.handler({});
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('いずれかを指定');
  });
});

describe('note_list_articles', () => {
  it('一覧を整形して返す', async () => {
    const fn = recordingFetch(() =>
      json({ data: { notes: [{ id: '1', key: 'n1', name: '記事A', status: 'published' }, { id: '2', key: 'n2', name: '下書きB', status: 'draft' }], totalCount: 2, isLastPage: true } }),
    ).fn;
    const r = await tools(fn).get('note_list_articles')!.handler({});
    expect(text(r)).toContain('記事一覧（2件中2件、ページ1）');
    expect(text(r)).toContain('[公開済み] 記事A (ID: 1、キー: n1)');
    expect(text(r)).toContain('[下書き] 下書きB (ID: 2、キー: n2)');
  });

  it('0件は「見つかりませんでした」', async () => {
    const fn = recordingFetch(() => json({ data: { notes: [] } })).fn;
    const r = await tools(fn).get('note_list_articles')!.handler({ status: 'draft' });
    expect(text(r)).toContain('記事が見つかりませんでした');
  });
});

describe('note_delete_draft', () => {
  const draft = { data: { id: '1', key: 'nabc', name: 'D', status: 'draft' } };

  it('confirm 省略はプレビュー', async () => {
    const { fn, calls } = recordingFetch(() => json(draft));
    const r = await tools(fn).get('note_delete_draft')!.handler({ article_key: 'nabc' });
    expect(text(r)).toContain('削除対象の記事');
    expect(text(r)).toContain('confirm=true');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('confirm=true で削除', async () => {
    const { fn } = recordingFetch((method) => (method === 'DELETE' ? json({}, 200) : json(draft)));
    const r = await tools(fn).get('note_delete_draft')!.handler({ article_key: 'nabc', confirm: true });
    expect(text(r)).toContain('削除しました');
  });

  it('公開済みは削除不可メッセージ', async () => {
    const fn = recordingFetch(() => json({ data: { id: '1', key: 'nabc', name: 'P', status: 'published' } })).fn;
    const r = await tools(fn).get('note_delete_draft')!.handler({ article_key: 'nabc', confirm: true });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('公開済みの記事は削除できません');
  });
});
