/**
 * note-core ドメイン型 — Electron / Node 固有 API に依存しない純粋な型のみ。
 * 移植元: drillan/note-mcp（MIT）の note_mcp/models.py。
 */

/** 記事の公開状態（note API の `status`）。 */
export type NoteArticleStatus = 'published' | 'draft';

/**
 * 記事サマリー（一覧・取得の共通形）。
 * note API の note オブジェクトを正規化（camelCase 化）したもの。
 * 必須は id / key / status（note-mcp の Article 6 準拠）。
 */
export interface NoteArticle {
  /** note 内部 ID（数値文字列） */
  id: string;
  /** URL パスに使うキー（例: n1234567890ab） */
  key: string;
  /** タイトル（API の `name`、下書きは noteDraft.name にフォールバック） */
  title: string;
  status: NoteArticleStatus;
  /** ハッシュタグ名（# なし） */
  tags: string[];
  /** アイキャッチ画像キー */
  eyecatchImageKey: string | null;
  /** 下書きプレビュー用アクセスキー */
  prevAccessKey: string | null;
  /** 作成日時（ISO8601） */
  createdAt: string | null;
  /** 更新日時（ISO8601） */
  updatedAt: string | null;
  /** 公開日時（API の `publish_at`） */
  publishedAt: string | null;
  /** 記事 URL（API の `noteUrl`） */
  url: string | null;
}

/** 本文つき記事（get_article・作成/更新/公開の戻り）。本文は note 専用 HTML。 */
export interface NoteArticleDetail extends NoteArticle {
  /** 本文（note 専用 HTML）。P2 は HTML をそのまま扱い、markdown 変換は P3 で追加。 */
  bodyHtml: string;
}

/** 記事の作成・更新の入力。P2 では本文は HTML 前提（markdown→HTML は P3）。 */
export interface NoteArticleInput {
  title: string;
  /** 本文（note 専用 HTML）。 */
  bodyHtml: string;
  /** ハッシュタグ（# は有無どちらでも可・内部で正規化）。 */
  tags?: string[];
}

/** 下書き削除の 2 段階フロー結果。 */
export type DeleteDraftOutcome =
  | { kind: 'preview'; articleKey: string; title: string; status: NoteArticleStatus }
  | { kind: 'deleted'; articleKey: string; title: string };

/** 現在のログインユーザー（認証確認用の最小情報）。 */
export interface NoteSelf {
  id: string;
  /** note ID（URL 名・例: bungo_ai_nosuke） */
  urlname: string;
}

/** note API エラーの分類（HTTP ステータス＋論理チェックから導出）。 */
export type NoteErrorCode =
  | 'not_authenticated'
  | 'not_found'
  | 'invalid_input'
  | 'rate_limited'
  | 'published_cannot_delete'
  | 'api_error';

/** 汎用の結果型（例外を投げず discriminated union で返す・wpClient と同流儀）。 */
export type NoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status?: number; code: NoteErrorCode; error: string };

/** 一覧取得結果（discriminated union・throw しない方針は wpClient と同じ）。 */
export type ListArticlesResult =
  | { ok: true; articles: NoteArticle[]; total: number; page: number; hasMore: boolean }
  | { ok: false; status?: number; error: string };

/** ログインユーザー取得結果。 */
export type GetSelfResult =
  | { ok: true; self: NoteSelf }
  | { ok: false; status?: number; error: string };
