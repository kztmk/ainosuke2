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
  DeleteDraftOutcome,
  GetSelfResult,
  ListArticlesResult,
  NoteArticle,
  NoteArticleDetail,
  NoteArticleInput,
  NoteArticleStatus,
  NoteErrorCode,
  NoteResult,
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

/** 変更系リクエストで要求される editor オリジン（note-mcp _build_headers 準拠）。 */
export const NOTE_EDITOR_ORIGIN = 'https://editor.note.com';
export const NOTE_EDITOR_REFERER = 'https://editor.note.com/';

/** タグを draft_save 形式へ（先頭 # を除去し {hashtag:{name}} 配列に）。 */
function normalizeTags(tags?: string[]): Array<{ hashtag: { name: string } }> | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map((t) => ({ hashtag: { name: t.replace(/^#+/, '') } }));
}

/** タグを publish 形式へ（先頭 # を付けた文字列配列に）。 */
function normalizeTagsForPublish(tags?: string[]): string[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map((t) => `#${t.replace(/^#+/, '')}`);
}

/** key 形式（n + 英数、純数値でない）か。 */
export function isArticleKeyFormat(articleId: string): boolean {
  return articleId.startsWith('n') && !/^\d+$/.test(articleId);
}

/** 2xx を成功とみなす（note は作成に 201 を返す等・note-mcp の is_success 準拠）。 */
function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** HTTP ステータスからエラーコードを導出。 */
function codeFromStatus(status: number): NoteErrorCode {
  if (status === 401) return 'not_authenticated';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'api_error';
}

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

  /** 全リクエスト共通のヘッダ（Accept + UA + Cookie）。 */
  private baseHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      Cookie: buildCookieHeader(this.getCookies()),
    };
  }

  /** GET リクエスト。JSON をパースして {status, json} を返す。 */
  private async apiGet(path: string): Promise<{ status: number; json: unknown }> {
    const res = await this.fetchFn(`${NOTE_API_BASE}${path}`, {
      method: 'GET',
      headers: this.baseHeaders(),
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
   * 変更系リクエスト（POST/PUT/DELETE）。XSRF ＋ editor Origin/Referer ＋ Sec-Fetch を付与。
   * body があれば JSON 化して Content-Type を付ける（note-mcp _build_headers 準拠）。
   */
  private async apiMutate(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const cookies = this.getCookies();
    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      Cookie: buildCookieHeader(cookies),
      Origin: NOTE_EDITOR_ORIGIN,
      Referer: NOTE_EDITOR_REFERER,
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    };
    const xsrf = cookies['XSRF-TOKEN'];
    if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchFn(`${NOTE_API_BASE}${path}`, init);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  /** GET /v3/notes/{keyOrId} の data を取り出す（記事詳細の生 data）。 */
  private async fetchNoteData(keyOrId: string): Promise<
    { ok: true; data: Record<string, unknown> } | { ok: false; status: number; code: NoteErrorCode; error: string }
  > {
    let status: number;
    let json: unknown;
    try {
      ({ status, json } = await this.apiGet(`/v3/notes/${keyOrId}`));
    } catch (e) {
      return { ok: false, status: 0, code: 'api_error', error: (e as Error).message };
    }
    if (!isSuccess(status)) return { ok: false, status, code: codeFromStatus(status), error: `HTTP ${status}` };
    const data = (json as { data?: Record<string, unknown> } | null)?.data;
    if (!data || typeof data !== 'object') {
      return { ok: false, status, code: 'api_error', error: 'missing data' };
    }
    return { ok: true, data };
  }

  /** key 形式を数値 ID へ解決（数値ならそのまま／key なら /v3/notes から id を引く）。 */
  private async resolveNumericId(articleId: string): Promise<NoteResult<string>> {
    if (/^\d+$/.test(articleId)) return { ok: true, value: articleId };
    if (!/^n[a-z0-9]+$/i.test(articleId)) {
      return { ok: false, code: 'invalid_input', error: `invalid note id: ${articleId}` };
    }
    const r = await this.fetchNoteData(articleId);
    if (!r.ok) return r;
    const id = r.data['id'];
    if (!id) return { ok: false, code: 'api_error', error: 'could not resolve numeric id' };
    return { ok: true, value: String(id) };
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
    if (!isSuccess(status)) return { ok: false, status, error: `HTTP ${status}` };

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

  /**
   * 下書きを新規作成。
   * 1) POST /v1/text_notes（本文なし）で id/key を得る
   * 2) POST /v1/text_notes/draft_save?id={id}&is_temp_saved=true で本文を保存
   * （埋め込みキー解決 Step は v2 スコープなので省略）
   */
  async createDraft(input: NoteArticleInput): Promise<NoteResult<NoteArticle>> {
    try {
      // Step 1: 本文なしで作成
      const createPayload: Record<string, unknown> = {
        name: input.title,
        index: false,
        is_lead_form: false,
      };
      const tags = normalizeTags(input.tags);
      if (tags) createPayload['hashtags'] = tags;

      const created = await this.apiMutate('POST', '/v1/text_notes', createPayload);
      if (!isSuccess(created.status)) {
        return { ok: false, status: created.status, code: codeFromStatus(created.status), error: `HTTP ${created.status}` };
      }
      const cdata = (created.json as { data?: Record<string, unknown> } | null)?.data ?? {};
      const id = cdata['id'];
      const key = cdata['key'];
      if (!id || !key) return { ok: false, code: 'api_error', error: 'create returned no id/key' };

      // Step 2: 本文を draft_save
      const savePayload: Record<string, unknown> = {
        name: input.title,
        index: false,
        is_lead_form: false,
        body: input.bodyHtml,
        body_length: input.bodyHtml.length,
      };
      if (tags) savePayload['hashtags'] = tags;

      const saved = await this.apiMutate(
        'POST',
        `/v1/text_notes/draft_save?id=${id}&is_temp_saved=true`,
        savePayload,
      );
      if (!isSuccess(saved.status)) {
        return { ok: false, status: saved.status, code: codeFromStatus(saved.status), error: `HTTP ${saved.status}` };
      }

      return {
        ok: true,
        value: {
          id: String(id),
          key: String(key),
          title: input.title,
          status: 'draft',
          tags: input.tags?.map((t) => t.replace(/^#+/, '')) ?? [],
          eyecatchImageKey: null,
          prevAccessKey: null,
          createdAt: null,
          updatedAt: null,
          publishedAt: null,
          url: null,
        },
      };
    } catch (e) {
      return { ok: false, code: 'api_error', error: (e as Error).message };
    }
  }

  /**
   * 既存記事を更新（下書き保存）。
   * key 形式は数値 ID へ解決してから POST /v1/text_notes/draft_save?id={numeric}&is_temp_saved=true。
   * draft_save は最小応答（{result,...}）なので、入力から Article を再構成して返す。
   */
  async updateDraft(articleId: string, input: NoteArticleInput): Promise<NoteResult<NoteArticle>> {
    try {
      const resolved = await this.resolveNumericId(articleId);
      if (!resolved.ok) return resolved;
      const numericId = resolved.value;

      const payload: Record<string, unknown> = {
        name: input.title,
        index: false,
        is_lead_form: false,
        body: input.bodyHtml,
        body_length: input.bodyHtml.length,
      };
      const tags = normalizeTags(input.tags);
      if (tags) payload['hashtags'] = tags;

      const saved = await this.apiMutate(
        'POST',
        `/v1/text_notes/draft_save?id=${numericId}&is_temp_saved=true`,
        payload,
      );
      if (!isSuccess(saved.status)) {
        return { ok: false, status: saved.status, code: codeFromStatus(saved.status), error: `HTTP ${saved.status}` };
      }
      const sdata = (saved.json as { data?: Record<string, unknown> } | null)?.data;
      if (!sdata || sdata['result'] === undefined) {
        return { ok: false, status: saved.status, code: 'api_error', error: 'draft_save returned empty response' };
      }

      return {
        ok: true,
        value: {
          id: numericId,
          key: isArticleKeyFormat(articleId) ? articleId : '',
          title: input.title,
          status: 'draft',
          tags: input.tags?.map((t) => t.replace(/^#+/, '')) ?? [],
          eyecatchImageKey: null,
          prevAccessKey: null,
          createdAt: null,
          updatedAt: null,
          publishedAt: null,
          url: null,
        },
      };
    } catch (e) {
      return { ok: false, code: 'api_error', error: (e as Error).message };
    }
  }

  /**
   * 記事を取得（本文つき）。GET /v3/notes/{key}（key 形式必須・数値 ID 非対応）。
   * 本文は note 専用 HTML のまま返す（HTML→markdown 変換は P3）。
   */
  async getArticle(articleKey: string): Promise<NoteResult<NoteArticleDetail>> {
    if (/^\d+$/.test(articleKey)) {
      return { ok: false, code: 'invalid_input', error: 'numeric id not supported; use article key (nXXXX)' };
    }
    const r = await this.fetchNoteData(articleKey);
    if (!r.ok) return r;
    const article = parseArticle(r.data);
    if (!article) return { ok: false, code: 'api_error', error: 'invalid article data (missing id/key/status)' };
    if ((r.data['status'] as string) === 'deleted') {
      return { ok: false, code: 'not_found', error: "article deleted (status='deleted')" };
    }
    const body = r.data['body'];
    return { ok: true, value: { ...article, bodyHtml: body != null ? String(body) : '' } };
  }

  /**
   * 下書きを公開。PUT /v1/text_notes/{numericId}（free_body・#tag 形式・status=published）。
   * 公開後に getArticle で再取得して返す（note-mcp 準拠）。
   */
  async publishArticle(articleKey: string, tags?: string[]): Promise<NoteResult<NoteArticleDetail>> {
    try {
      const resolved = await this.resolveNumericId(articleKey);
      if (!resolved.ok) return resolved;
      const numericId = resolved.value;

      // タイトル・本文を取得（下書きは note_draft 側に完全な本文がある）
      const r = await this.fetchNoteData(articleKey);
      if (!r.ok) return r;
      const data = r.data;
      const noteDraft = (data['note_draft'] as Record<string, unknown> | undefined) ?? undefined;
      const title = (data['name'] as string) || (noteDraft?.['name'] as string) || '';
      const body = (noteDraft?.['body'] as string) || (data['body'] as string) || '';

      const payload: Record<string, unknown> = {
        name: title,
        free_body: body,
        body_length: body.length,
        status: 'published',
        index: false,
      };
      const tagsPub = normalizeTagsForPublish(tags);
      if (tagsPub) payload['hashtags'] = tagsPub;

      const put = await this.apiMutate('PUT', `/v1/text_notes/${numericId}`, payload);
      if (!isSuccess(put.status)) {
        return { ok: false, status: put.status, code: codeFromStatus(put.status), error: `HTTP ${put.status}` };
      }
      const pdata = (put.json as { data?: Record<string, unknown> } | null)?.data;
      if (pdata && pdata['result'] === false) {
        return { ok: false, status: put.status, code: 'api_error', error: 'publish failed (result=false)' };
      }

      return this.getArticle(articleKey);
    } catch (e) {
      return { ok: false, code: 'api_error', error: (e as Error).message };
    }
  }

  /**
   * 下書きを削除（2 段階）。confirm=false でプレビュー、true で DELETE /v1/notes/n/{key}。
   * 公開記事・削除済みは削除不可（エラー）。
   */
  async deleteDraft(
    articleKey: string,
    opts: { confirm?: boolean } = {},
  ): Promise<NoteResult<DeleteDraftOutcome>> {
    try {
      const r = await this.fetchNoteData(articleKey);
      if (!r.ok) return r;
      const article = parseArticle(r.data);
      if (!article) return { ok: false, code: 'api_error', error: 'invalid article data' };

      if (article.status === 'published') {
        return { ok: false, code: 'published_cannot_delete', error: 'cannot delete a published article' };
      }
      if ((r.data['status'] as string) === 'deleted') {
        return { ok: false, code: 'not_found', error: "article deleted (status='deleted')" };
      }

      if (!opts.confirm) {
        return {
          ok: true,
          value: { kind: 'preview', articleKey: article.key, title: article.title, status: article.status },
        };
      }

      const del = await this.apiMutate('DELETE', `/v1/notes/n/${articleKey}`);
      if (!isSuccess(del.status)) {
        return { ok: false, status: del.status, code: codeFromStatus(del.status), error: `HTTP ${del.status}` };
      }
      return { ok: true, value: { kind: 'deleted', articleKey: article.key, title: article.title } };
    } catch (e) {
      return { ok: false, code: 'api_error', error: (e as Error).message };
    }
  }
}

/** ファクトリ（plan の createNoteClient に対応）。 */
export function createNoteClient(deps: NoteClientDeps): NoteClient {
  return new NoteClient(deps);
}
