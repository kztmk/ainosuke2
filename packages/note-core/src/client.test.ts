/**
 * note-core クライアントのテスト。fetch を注入（wpClient.test.ts と同じ流儀）。
 * 応答形は実 note.com の note_list/self を模したゴールデン。
 */
import { describe, expect, it, vi } from 'vitest';
import { NoteClient, createNoteClient, buildCookieHeader, parseArticle, type FetchLike } from './client.js';

const COOKIES = { _note_session_v5: 'sess', note_gql_auth_token: 'gql', XSRF_TOKEN: 'x' };

function fakeFetch(responder: (url: string, init?: RequestInit) => Response): FetchLike {
  return vi.fn(async (url: string, init?: RequestInit) => responder(url, init));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// 実 note の note_list/contents 応答を模したノート1件（第7回…）。
const NOTE_ITEM = {
  id: 123456,
  key: 'n346f6b989225',
  name: '第7回 Chain-of-Thought',
  status: 'published',
  publish_at: '2026-06-01T09:00:00+09:00',
  created_at: '2026-05-30T00:00:00+09:00',
  updated_at: '2026-06-01T00:00:00+09:00',
  noteUrl: 'https://note.com/bungo_ai_nosuke/n/n346f6b989225',
  eyecatch_image_key: 'eyekey',
  hashtags: [{ hashtag: { name: 'AI' } }, { hashtag: { name: '生成AI' } }],
};

describe('buildCookieHeader', () => {
  it('Cookie マップを k=v; k=v へ結合する', () => {
    expect(buildCookieHeader({ a: '1', b: '2' })).toBe('a=1; b=2');
  });
});

describe('parseArticle', () => {
  it('note オブジェクトを NoteArticle に正規化する', () => {
    const a = parseArticle(NOTE_ITEM);
    expect(a).toEqual({
      id: '123456',
      key: 'n346f6b989225',
      title: '第7回 Chain-of-Thought',
      status: 'published',
      tags: ['AI', '生成AI'],
      eyecatchImageKey: 'eyekey',
      prevAccessKey: null,
      createdAt: '2026-05-30T00:00:00+09:00',
      updatedAt: '2026-06-01T00:00:00+09:00',
      publishedAt: '2026-06-01T09:00:00+09:00',
      url: 'https://note.com/bungo_ai_nosuke/n/n346f6b989225',
    });
  });

  it('下書きは noteDraft.name をタイトルにフォールバックする', () => {
    const a = parseArticle({ id: 1, key: 'nx', status: 'draft', noteDraft: { name: '下書きタイトル' } });
    expect(a?.title).toBe('下書きタイトル');
  });

  it('必須（id/key/status）欠落は null', () => {
    expect(parseArticle({ key: 'nx', status: 'draft' })).toBeNull();
    expect(parseArticle({ id: 1, status: 'draft' })).toBeNull();
    expect(parseArticle({ id: 1, key: 'nx' })).toBeNull();
  });
});

describe('listArticles', () => {
  it('200 の note_list を正規化して返す', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: { notes: [NOTE_ITEM], totalCount: 7, isLastPage: true } })),
    });
    const res = await client.listArticles();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.total).toBe(7);
      expect(res.hasMore).toBe(false);
      expect(res.articles).toHaveLength(1);
      expect(res.articles[0]?.key).toBe('n346f6b989225');
    }
  });

  it('page と publish_status=draft をクエリに載せ、Cookie ヘッダを付ける', async () => {
    const fetchFn = fakeFetch(() => json({ data: { notes: [] } }));
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn });
    await client.listArticles({ page: 2, status: 'draft' });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://note.com/api/v2/note_list/contents?page=2&publish_status=draft',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Cookie: '_note_session_v5=sess; note_gql_auth_token=gql; XSRF_TOKEN=x',
        }),
      }),
    );
  });

  it('必須欠落のノートはスキップする（全体は throw しない）', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: { notes: [NOTE_ITEM, { name: 'broken' }] } })),
    });
    const res = await client.listArticles();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.articles).toHaveLength(1);
  });

  it('limit で切り詰める（最大 10）', async () => {
    const notes = Array.from({ length: 10 }, (_, i) => ({ ...NOTE_ITEM, id: i + 1, key: `n${i}` }));
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: { notes } })),
    });
    const res = await client.listArticles({ limit: 3 });
    if (res.ok) expect(res.articles).toHaveLength(3);
  });

  it('非 200 は status 付き失敗（throw しない）', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({}, 401)),
    });
    const res = await client.listArticles();
    expect(res).toEqual({ ok: false, status: 401, error: 'HTTP 401' });
  });

  it('ネットワーク例外は error を返す', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const res = await client.listArticles();
    expect(res).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('getCookies は毎回読まれる（再ログインで最新セッションを反映）', async () => {
    let cookies = { _note_session_v5: 'old' };
    const fetchFn = fakeFetch(() => json({ data: { notes: [] } }));
    const client = createNoteClient({ getCookies: () => cookies, fetchFn });
    await client.listArticles();
    cookies = { _note_session_v5: 'new' };
    await client.listArticles();
    expect(fetchFn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: '_note_session_v5=new' }) }),
    );
  });
});

describe('getSelf', () => {
  it('/v1/stats/pv 200 から user_id/urlname を取る', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch((url) =>
        url.includes('/v1/stats/pv')
          ? json({ data: { user_id: '999', urlname: 'bungo_ai_nosuke' } })
          : json({}, 404),
      ),
    });
    const res = await client.getSelf();
    expect(res).toEqual({ ok: true, self: { id: '999', urlname: 'bungo_ai_nosuke' } });
  });

  it('pv が不足なら /v2/self にフォールバックする', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch((url) =>
        url.includes('/v2/self')
          ? json({ data: { id: 42, urlname: 'fallback_user' } })
          : json({}, 400),
      ),
    });
    const res = await client.getSelf();
    expect(res).toEqual({ ok: true, self: { id: '42', urlname: 'fallback_user' } });
  });

  it('どちらも取れなければ失敗（status 付き）', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch((url) => (url.includes('/v1/stats/pv') ? json({}, 400) : json({}, 404))),
    });
    const res = await client.getSelf();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });
});
