/**
 * NoteClient — note.com 非公式 API クライアント（session 注入式・Electron 非依存）。
 * fetch を注入可能にしてネットワーク非依存でテストする（wpClient と同じ流儀）。
 * 移植元: drillan/note-mcp（MIT）の note_mcp/api/client.py・articles.py・auth/browser.py。
 *
 * 認証は「全 note Cookie を Cookie ヘッダに載せる」方式。セッションは注入された
 * getCookies() から毎回読むので、アプリ側で再ログインしても最新セッションで叩ける。
 * GET は Cookie + Accept のみ。変更系（XSRF ヘッダ等）は P2 で追加する。
 */

import type {
  GetSelfResult,
  ListArticlesResult,
  NoteArticle,
  NoteArticleStatus,
} from './models.js';

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface NoteClientDeps {
  /**
   * 現在の note セッション Cookie（name → value）。
   * 関数注入なのは、再ログイン後も常に最新の Cookie を読むため。
   */
  getCookies: () => Record<string, string>;
  fetchFn?: FetchLike;
  /** リクエストの User-Agent（省略時はブラウザ UA）。 */
  userAgent?: string;
}

export const NOTE_API_BASE = 'https://note.com/api';

/**
 * 既定 User-Agent。note API は非ブラウザ UA を弾くことがあるため、
 * サーバー側（Node）からでもブラウザ UA を送る（note-mcp 準拠）。
 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Cookie マップを "k=v; k=v" 形式のヘッダ値へ。 */
export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** note の note オブジェクトを NoteArticle へ正規化。必須欠落（id/key/status）は null を返す（呼び出し側でスキップ）。 */
export function parseArticle(item: Record<string, unknown>): NoteArticle | null {
  const id = item['id'];
  const key = item['key'];
  const status = item['status'];
  if (!id || !key || typeof status !== 'string' || !status) return null;

  // title: name → noteDraft.name
  let title = item['name'];
  if (!title) {
    const draft = item['noteDraft'];
    if (draft && typeof draft === 'object') {
      title = (draft as Record<string, unknown>)['name'];
    }
  }

  // tags: hashtags[].hashtag.name
  const tags: string[] = [];
  const hashtags = item['hashtags'];
  if (Array.isArray(hashtags)) {
    for (const ht of hashtags) {
      const hobj = ht && typeof ht === 'object' ? (ht as Record<string, unknown>)['hashtag'] : null;
      const name = hobj && typeof hobj === 'object' ? (hobj as Record<string, unknown>)['name'] : null;
      if (name) tags.push(String(name));
    }
  }

  const str = (v: unknown): string | null => (v ? String(v) : null);

  return {
    id: String(id),
    key: String(key),
    title: title ? String(title) : '',
    status: status as NoteArticleStatus,
    tags,
    eyecatchImageKey: str(item['eyecatch_image_key']),
    prevAccessKey: str(item['prev_access_key']),
    createdAt: str(item['created_at']),
    updatedAt: str(item['updated_at']),
    publishedAt: str(item['publish_at']),
    url: str(item['noteUrl']),
  };
}

export class NoteClient {
  private readonly fetchFn: FetchLike;
  private readonly getCookies: () => Record<string, string>;
  private readonly userAgent: string;

  constructor(deps: NoteClientDeps) {
    this.getCookies = deps.getCookies;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
  }

  /** GET リクエスト（Cookie + Accept + UA を付与）。JSON をパースして {status, json} を返す。 */
  private async apiGet(path: string): Promise<{ status: number; json: unknown }> {
    const res = await this.fetchFn(`${NOTE_API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
        Cookie: buildCookieHeader(this.getCookies()),
      },
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  /**
   * 認証ユーザーの記事一覧（下書き＋公開）。
   * GET /v2/note_list/contents?page=N[&publish_status=draft|published]
   * limit は最大 10（クライアント側でも切り詰め）。
   */
  async listArticles(
    opts: { page?: number; status?: NoteArticleStatus; limit?: number } = {},
  ): Promise<ListArticlesResult> {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 10, 10);
    let path = `/v2/note_list/contents?page=${page}`;
    if (opts.status) path += `&publish_status=${opts.status}`;

    let status: number;
    let json: unknown;
    try {
      ({ status, json } = await this.apiGet(path));
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    if (status !== 200) return { ok: false, status, error: `HTTP ${status}` };

    const data = (json as { data?: Record<string, unknown> } | null)?.data ?? {};
    const rawNotes = Array.isArray(data['notes']) ? (data['notes'] as unknown[]) : [];
    const articles: NoteArticle[] = [];
    for (const item of rawNotes) {
      if (item && typeof item === 'object') {
        const a = parseArticle(item as Record<string, unknown>);
        if (a) articles.push(a);
      }
    }
    const total = typeof data['totalCount'] === 'number' ? (data['totalCount'] as number) : rawNotes.length;
    const hasMore = data['isLastPage'] === false;
    return { ok: true, articles: articles.slice(0, limit), total, page, hasMore };
  }

  /**
   * 現在のログインユーザー。GET /v1/stats/pv（主）→ /v2/self（フォールバック）。
   * note-mcp のサーバー側（httpx）実装と同じ。ブラウザ文脈では 400/404 になるため、
   * アプリのログイン判定は BrowserWindow の /settings/account ページ読み取りで行い、
   * こちらは note-core（Node/サーバー側）から叩く用途。
   */
  async getSelf(): Promise<GetSelfResult> {
    const pick = (json: unknown): { id: string; urlname: string } | null => {
      const d = (json as { data?: Record<string, unknown> } | null)?.data;
      if (!d || typeof d !== 'object') return null;
      const id = d['user_id'] ?? d['id'] ?? '';
      const urlname = d['urlname'] ?? d['username'] ?? '';
      if (!id && !urlname) return null;
      return { id: String(id ?? ''), urlname: String(urlname ?? '') };
    };

    try {
      const pv = await this.apiGet('/v1/stats/pv');
      if (pv.status === 200) {
        const u = pick(pv.json);
        if (u && u.id && u.urlname) return { ok: true, self: u };
      }
      const self = await this.apiGet('/v2/self');
      if (self.status === 200) {
        const u = pick(self.json);
        if (u) return { ok: true, self: { id: u.id, urlname: u.urlname } };
      }
      return { ok: false, status: self.status, error: `self unavailable (pv=${pv.status}, self=${self.status})` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/** ファクトリ（plan の createNoteClient に対応）。 */
export function createNoteClient(deps: NoteClientDeps): NoteClient {
  return new NoteClient(deps);
}
