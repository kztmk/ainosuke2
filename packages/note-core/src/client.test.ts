/**
 * note-core クライアントのテスト。fetch を注入（wpClient.test.ts と同じ流儀）。
 * 応答形は実 note.com の note_list/self を模したゴールデン。
 */
import { describe, expect, it, vi } from 'vitest';
import { NoteClient, createNoteClient, buildCookieHeader, parseArticle, type FetchLike } from './client.js';

const COOKIES = { _note_session_v5: 'sess', note_gql_auth_token: 'gql', 'XSRF-TOKEN': 'xtok' };

function fakeFetch(responder: (url: string, init?: RequestInit) => Response): FetchLike {
  return vi.fn(async (url: string, init?: RequestInit) => responder(url, init));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** メソッド/URL/ヘッダ/ボディを記録するフェイク fetch。 */
function recordingFetch(responder: (method: string, url: string, body: unknown) => Response): {
  fn: FetchLike;
  calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }>;
} {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  const fn: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    return responder(method, url, body);
  });
  return { fn, calls };
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
          Cookie: '_note_session_v5=sess; note_gql_auth_token=gql; XSRF-TOKEN=xtok',
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

describe('createDraft', () => {
  it('本文なし作成→draft_save の2段で id/key を返し、変更系ヘッダを付ける', async () => {
    const { fn, calls } = recordingFetch((method, url) => {
      if (url.endsWith('/v1/text_notes') && method === 'POST') return json({ data: { id: '123', key: 'nabc' } });
      if (url.includes('/draft_save') && method === 'POST') return json({ data: { result: true } });
      return json({}, 500);
    });
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    const res = await client.createDraft({ title: 'タイトル', bodyHtml: '<p>本文</p>', tags: ['#AI', 'note'] });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toMatchObject({ id: '123', key: 'nabc', title: 'タイトル', status: 'draft', tags: ['AI', 'note'] });
    }
    // Step1: 本文なし
    expect(calls[0]?.url).toBe('https://note.com/api/v1/text_notes');
    expect(calls[0]?.body).toEqual({ name: 'タイトル', index: false, is_lead_form: false, hashtags: [{ hashtag: { name: 'AI' } }, { hashtag: { name: 'note' } }] });
    // Step2: draft_save に本文と body_length
    expect(calls[1]?.url).toBe('https://note.com/api/v1/text_notes/draft_save?id=123&is_temp_saved=true');
    expect(calls[1]?.body).toMatchObject({ name: 'タイトル', body: '<p>本文</p>', body_length: 9 });
    // 変更系ヘッダ
    expect(calls[0]?.headers).toMatchObject({
      'X-XSRF-TOKEN': 'xtok',
      Origin: 'https://editor.note.com',
      Referer: 'https://editor.note.com/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    });
  });

  it('POST が 201 Created でも成功として扱う（note は作成に 201 を返す）', async () => {
    const { fn } = recordingFetch((method, url) => {
      if (url.endsWith('/v1/text_notes') && method === 'POST') return json({ data: { id: '1', key: 'nx' } }, 201);
      return json({ data: { result: true } }, 201);
    });
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    const res = await client.createDraft({ title: 't', bodyHtml: 'x' });
    expect(res.ok).toBe(true);
  });

  it('作成が非2xxなら失敗', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({}, 401)),
    });
    const res = await client.createDraft({ title: 't', bodyHtml: 'x' });
    expect(res).toMatchObject({ ok: false, status: 401, code: 'not_authenticated' });
  });

  it('id/key が返らなければ api_error', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: {} })),
    });
    const res = await client.createDraft({ title: 't', bodyHtml: 'x' });
    expect(res).toMatchObject({ ok: false, code: 'api_error' });
  });
});

describe('updateDraft', () => {
  it('key形式は数値IDへ解決してから draft_save する', async () => {
    const { fn, calls } = recordingFetch((method, url) => {
      if (url.endsWith('/v3/notes/nabc') && method === 'GET') return json({ data: { id: '123', key: 'nabc' } });
      if (url.includes('/draft_save') && method === 'POST') return json({ data: { result: true } });
      return json({}, 500);
    });
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    const res = await client.updateDraft('nabc', { title: '新', bodyHtml: '<p>x</p>' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ id: '123', key: 'nabc', title: '新', status: 'draft' });
    expect(calls[0]?.url).toBe('https://note.com/api/v3/notes/nabc');
    expect(calls[1]?.url).toBe('https://note.com/api/v1/text_notes/draft_save?id=123&is_temp_saved=true');
  });

  it('数値IDはそのまま draft_save（解決の GET を打たない）', async () => {
    const { fn, calls } = recordingFetch(() => json({ data: { result: true } }));
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    await client.updateDraft('999', { title: 't', bodyHtml: 'x' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://note.com/api/v1/text_notes/draft_save?id=999&is_temp_saved=true');
  });

  it('draft_save が result を欠くと api_error', async () => {
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fakeFetch(() => json({ data: {} })) });
    const res = await client.updateDraft('999', { title: 't', bodyHtml: 'x' });
    expect(res).toMatchObject({ ok: false, code: 'api_error' });
  });
});

describe('getArticle', () => {
  it('本文つきで返す（HTMLのまま）', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: { id: '1', key: 'nabc', name: 'T', status: 'published', body: '<p>本文</p>' } })),
    });
    const res = await client.getArticle('nabc');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toMatchObject({ key: 'nabc', title: 'T', status: 'published', bodyHtml: '<p>本文</p>' });
  });

  it('数値IDは invalid_input', async () => {
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fakeFetch(() => json({})) });
    const res = await client.getArticle('12345');
    expect(res).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it("status='deleted' は not_found", async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: { id: '1', key: 'nabc', status: 'deleted', body: '' } })),
    });
    const res = await client.getArticle('nabc');
    expect(res).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('404 は not_found', async () => {
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fakeFetch(() => json({}, 404)) });
    const res = await client.getArticle('nabc');
    expect(res).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });
});

describe('publishArticle', () => {
  it('PUT /v1/text_notes/{id} に free_body・#tag・status=published を送り、再取得して返す', async () => {
    const { fn, calls } = recordingFetch((method, url) => {
      if (url.endsWith('/v3/notes/nabc') && method === 'GET') {
        return json({ data: { id: '123', key: 'nabc', name: 'T', status: 'draft', note_draft: { name: 'T', body: '<p>b</p>' } } });
      }
      if (url.endsWith('/v1/text_notes/123') && method === 'PUT') return json({ data: { result: true } });
      return json({}, 500);
    });
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    const res = await client.publishArticle('nabc', ['AI']);
    expect(res.ok).toBe(true);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('https://note.com/api/v1/text_notes/123');
    expect(put?.body).toMatchObject({ name: 'T', free_body: '<p>b</p>', status: 'published', index: false, hashtags: ['#AI'] });
  });

  it('result=false は api_error', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch((url) => {
        if (url.endsWith('/v3/notes/nabc')) return json({ data: { id: '123', key: 'nabc', name: 'T', status: 'draft' } });
        return json({ data: { result: false } });
      }),
    });
    const res = await client.publishArticle('nabc');
    expect(res).toMatchObject({ ok: false, code: 'api_error' });
  });
});

describe('deleteDraft', () => {
  const draftData = { data: { id: '1', key: 'nabc', name: 'D', status: 'draft' } };

  it('confirm=false はプレビューを返し、DELETE を打たない', async () => {
    const { fn, calls } = recordingFetch(() => json(draftData));
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    const res = await client.deleteDraft('nabc');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ kind: 'preview', articleKey: 'nabc', title: 'D', status: 'draft' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('confirm=true は DELETE /v1/notes/n/{key} を打つ', async () => {
    const { fn, calls } = recordingFetch((method, url) => {
      if (method === 'DELETE') return json({}, 200);
      return json(draftData);
    });
    const client = new NoteClient({ getCookies: () => COOKIES, fetchFn: fn });
    const res = await client.deleteDraft('nabc', { confirm: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ kind: 'deleted', articleKey: 'nabc', title: 'D' });
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('https://note.com/api/v1/notes/n/nabc');
  });

  it('公開記事は published_cannot_delete', async () => {
    const client = new NoteClient({
      getCookies: () => COOKIES,
      fetchFn: fakeFetch(() => json({ data: { id: '1', key: 'nabc', name: 'P', status: 'published' } })),
    });
    const res = await client.deleteDraft('nabc', { confirm: true });
    expect(res).toMatchObject({ ok: false, code: 'published_cannot_delete' });
  });
});
