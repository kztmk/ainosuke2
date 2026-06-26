/**
 * wpClient — WordPress REST API 疎通とサマリー取得（仕様 v1.2 §5.3.1 / §5.1.2 / 同期）。
 * fetch を注入可能にして Electron/ネットワーク非依存でテストする。
 */

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface BasicAuth {
  username: string;
  applicationPassword: string;
}

export type RestCheckResult =
  | { ok: true; status: number; publishedCount: number | null }
  | { ok: false; status?: number; error: string };

export interface SiteSummary {
  publishedCount: number | null;
  draftCount: number | null;
}

function basicAuthHeader(auth: BasicAuth): string {
  const token = Buffer.from(`${auth.username}:${auth.applicationPassword}`).toString('base64');
  return `Basic ${token}`;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** X-WP-Total ヘッダから総数を取り出す（無ければ null）。 */
function readTotal(res: Response): number | null {
  const raw = res.headers.get('X-WP-Total');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export class WpClient {
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  /** REST 疎通確認（接続テストの REST パート・同期）。公開投稿数を X-WP-Total から拾う。 */
  async checkRest(siteUrl: string, auth?: BasicAuth): Promise<RestCheckResult> {
    const url = `${trimTrailingSlash(siteUrl)}/wp-json/wp/v2/posts?per_page=1`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        headers: auth ? { Authorization: basicAuthHeader(auth) } : {},
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, publishedCount: readTotal(res) };
  }

  /** 指定ステータスの投稿総数を取得（status 省略時は公開＝publish）。 */
  async getPostCount(
    siteUrl: string,
    opts: { auth?: BasicAuth; status?: 'publish' | 'draft' } = {},
  ): Promise<number | null> {
    const base = `${trimTrailingSlash(siteUrl)}/wp-json/wp/v2/posts?per_page=1`;
    const url = opts.status ? `${base}&status=${opts.status}` : base;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        headers: opts.auth ? { Authorization: basicAuthHeader(opts.auth) } : {},
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    return readTotal(res);
  }

  /** サマリー（投稿数・下書き数）。下書きは認証が要るため auth 必須。 */
  async fetchSummary(siteUrl: string, auth: BasicAuth): Promise<SiteSummary> {
    const [publishedCount, draftCount] = await Promise.all([
      this.getPostCount(siteUrl, { auth, status: 'publish' }),
      this.getPostCount(siteUrl, { auth, status: 'draft' }),
    ]);
    return { publishedCount, draftCount };
  }
}
