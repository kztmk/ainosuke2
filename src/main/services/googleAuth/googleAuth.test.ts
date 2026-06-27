import { describe, expect, it } from 'vitest';
import { signInWithGoogleLoopback, type GoogleAuthDeps } from './googleAuth.js';

const config = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sekret' };

/** auth URL から redirect_uri と state を取り出し、ブラウザのリダイレクトを模してループバックを叩く。 */
function fakeBrowser(query: (params: URLSearchParams) => string): GoogleAuthDeps['openExternal'] {
  return async (authUrl: string) => {
    const u = new URL(authUrl);
    const redirect = u.searchParams.get('redirect_uri')!;
    const state = u.searchParams.get('state')!;
    const params = new URLSearchParams(query(new URLSearchParams({ state })));
    await fetch(`${redirect}/?${params.toString()}`);
  };
}

describe('signInWithGoogleLoopback', () => {
  it('happy path: code を受け取り token endpoint で id_token を得る', async () => {
    let exchanged: URLSearchParams | null = null;
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        exchanged = new URLSearchParams(String(init?.body));
        return new Response(JSON.stringify({ id_token: 'ID_TOKEN_123' }), { status: 200 });
      }
      // ループバックへの GET は本物の fetch を使う（fakeBrowser 内）
      return fetch(url as string, init);
    }) as unknown as typeof fetch;

    const res = await signInWithGoogleLoopback({
      config,
      fetch: fakeFetch,
      openExternal: fakeBrowser((p) => {
        p.set('code', 'AUTH_CODE');
        return p.toString();
      }),
    });

    expect(res).toEqual({ ok: true, idToken: 'ID_TOKEN_123' });
    expect(exchanged!.get('code')).toBe('AUTH_CODE');
    expect(exchanged!.get('grant_type')).toBe('authorization_code');
    expect(exchanged!.get('code_verifier')).toBeTruthy(); // PKCE
    expect(exchanged!.get('client_secret')).toBe('sekret');
  });

  it('未設定なら not_configured', async () => {
    const res = await signInWithGoogleLoopback({
      config: { clientId: '', clientSecret: '' },
      fetch,
      openExternal: () => undefined,
    });
    expect(res).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('state 不一致は state_mismatch', async () => {
    const res = await signInWithGoogleLoopback({
      config,
      fetch,
      openExternal: async (authUrl) => {
        const u = new URL(authUrl);
        const redirect = u.searchParams.get('redirect_uri')!;
        await fetch(`${redirect}/?code=X&state=WRONG`);
      },
    });
    expect(res).toEqual({ ok: false, reason: 'state_mismatch' });
  });

  it('token 交換失敗は token_exchange_failed', async () => {
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com/token')) return new Response('nope', { status: 400 });
      return fetch(url as string, init);
    }) as unknown as typeof fetch;

    const res = await signInWithGoogleLoopback({
      config,
      fetch: fakeFetch,
      openExternal: fakeBrowser((p) => {
        p.set('code', 'AUTH_CODE');
        return p.toString();
      }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('token_exchange_failed');
  });
});
