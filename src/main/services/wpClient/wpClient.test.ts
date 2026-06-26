/**
 * wpClient ゴールデンテスト（§5.3.1 / §5.1.2 / 同期）。fetch を注入。
 */
import { describe, expect, it, vi } from 'vitest';
import { WpClient, type FetchLike } from './wpClient.js';

const AUTH = { username: 'editor', applicationPassword: 'app pass word here' };

function fakeFetch(responder: (url: string, init?: RequestInit) => Response): FetchLike {
  return vi.fn(async (url: string, init?: RequestInit) => responder(url, init));
}

describe('checkRest', () => {
  it('200 + X-WP-Total から公開投稿数を取得する', async () => {
    const client = new WpClient(
      fakeFetch(() => new Response('[]', { status: 200, headers: { 'X-WP-Total': '142' } })),
    );
    const res = await client.checkRest('https://example.com');
    expect(res).toEqual({ ok: true, status: 200, publishedCount: 142 });
  });

  it('末尾スラッシュを正規化して /wp-json/wp/v2/posts を叩く', async () => {
    const fetchFn = fakeFetch(() => new Response('[]', { status: 200 }));
    const client = new WpClient(fetchFn);
    await client.checkRest('https://example.com/');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/wp-json/wp/v2/posts?per_page=1',
      expect.anything(),
    );
  });

  it('auth 指定時は Basic 認証ヘッダを付ける', async () => {
    const fetchFn = fakeFetch(() => new Response('[]', { status: 200 }));
    const client = new WpClient(fetchFn);
    await client.checkRest('https://example.com', AUTH);
    const expected = 'Basic ' + Buffer.from('editor:app pass word here').toString('base64');
    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: expected } }),
    );
  });

  it('非 2xx は status 付きの失敗を返す', async () => {
    const client = new WpClient(fakeFetch(() => new Response('forbidden', { status: 403 })));
    const res = await client.checkRest('https://example.com');
    expect(res).toEqual({ ok: false, status: 403, error: 'HTTP 403' });
  });

  it('ネットワーク例外は error を返す（throw しない）', async () => {
    const client = new WpClient(
      fakeFetch(() => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await client.checkRest('https://example.com');
    expect(res).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('X-WP-Total が無ければ publishedCount は null', async () => {
    const client = new WpClient(fakeFetch(() => new Response('[]', { status: 200 })));
    const res = await client.checkRest('https://example.com');
    expect(res).toEqual({ ok: true, status: 200, publishedCount: null });
  });
});

describe('fetchSummary', () => {
  it('公開数と下書き数を取得する（status=draft を含めて2回叩く）', async () => {
    const fetchFn = fakeFetch((url) => {
      const total = url.includes('status=draft') ? '3' : '142';
      return new Response('[]', { status: 200, headers: { 'X-WP-Total': total } });
    });
    const client = new WpClient(fetchFn);
    const summary = await client.fetchSummary('https://example.com', AUTH);
    expect(summary).toEqual({ publishedCount: 142, draftCount: 3 });
  });
});
