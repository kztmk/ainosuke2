/**
 * googleAuth — システムブラウザ＋ループバックによる Google OAuth（PKCE）。
 *
 * Electron は Google から「embedded user agent」と見なされ signInWithPopup 等が弾かれるため、
 * 既定ブラウザで認可 → 127.0.0.1 のループバックで code を受け取り → token endpoint で id_token を得る。
 * 得た id_token は renderer の signInWithCredential(GoogleAuthProvider.credential(idToken)) に渡す。
 *
 * すべての外部依存（fetch / openExternal / 設定）は注入し、Electron 無しでテストできるようにする。
 */
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { GoogleSignInResult } from '../../../shared/ipc.js';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleAuthDeps {
  config: GoogleOAuthConfig;
  openExternal(url: string): Promise<void> | void;
  fetch: typeof fetch;
  /** ループバック待ちのタイムアウト（ms）。既定 180 秒。 */
  timeoutMs?: number;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function resultPage(message: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>WP MCP Manager</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}
.box{text-align:center}</style></head>
<body><div class="box"><h2>${message}</h2><p>このタブは閉じて構いません。</p></div></body></html>`;
}

interface CodeResult {
  code: string;
  state: string | null;
  error?: string;
}

/** 127.0.0.1 の一時 HTTP サーバを起動し、リダイレクトの code を待つ。 */
function startLoopbackServer(
  server: Server,
): Promise<{ port: number; waitForCode: (timeoutMs: number) => Promise<CodeResult> }> {
  return new Promise((resolve) => {
    let deliver: ((r: CodeResult) => void) | null = null;
    let pending: CodeResult | null = null;

    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const state = reqUrl.searchParams.get('state');
      if (!code && !error) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(resultPage(error ? 'サインインに失敗しました。' : 'サインインが完了しました。アプリに戻ってください。'));
      const result: CodeResult = { code: code ?? '', state, error: error ?? undefined };
      // 待機開始前にリダイレクトが届いても取りこぼさないようバッファする
      if (deliver) deliver(result);
      else pending = result;
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        waitForCode: (timeoutMs) =>
          new Promise<CodeResult>((res, rej) => {
            if (pending) {
              res(pending);
              return;
            }
            const timer = setTimeout(() => rej(new Error('timeout')), timeoutMs);
            deliver = (r) => {
              clearTimeout(timer);
              res(r);
            };
          }),
      });
    });
  });
}

export async function signInWithGoogleLoopback(deps: GoogleAuthDeps): Promise<GoogleSignInResult> {
  const { clientId, clientSecret } = deps.config;
  if (!clientId || !clientSecret) return { ok: false, reason: 'not_configured' };

  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  const state = b64url(randomBytes(16));

  const server = createServer();
  try {
    const { port, waitForCode } = await startLoopbackServer(server);
    const redirectUri = `http://127.0.0.1:${port}`;

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');

    await deps.openExternal(url.toString());

    const received = await waitForCode(deps.timeoutMs ?? 180_000);
    if (received.error) return { ok: false, reason: 'cancelled', message: received.error };
    if (received.state !== state) return { ok: false, reason: 'state_mismatch' };
    if (!received.code) return { ok: false, reason: 'cancelled' };

    const body = new URLSearchParams({
      code: received.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });
    const res = await deps.fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return { ok: false, reason: 'token_exchange_failed', message: `HTTP ${res.status}` };

    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) return { ok: false, reason: 'no_id_token' };
    return { ok: true, idToken: json.id_token };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  } finally {
    server.close();
  }
}
