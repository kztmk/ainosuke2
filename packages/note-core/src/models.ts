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

/** 現在のログインユーザー（認証確認用の最小情報）。 */
export interface NoteSelf {
  id: string;
  /** note ID（URL 名・例: bungo_ai_nosuke） */
  urlname: string;
}

/** 一覧取得結果（discriminated union・throw しない方針は wpClient と同じ）。 */
export type ListArticlesResult =
  | { ok: true; articles: NoteArticle[]; total: number; page: number; hasMore: boolean }
  | { ok: false; status?: number; error: string };

/** ログインユーザー取得結果。 */
export type GetSelfResult =
  | { ok: true; self: NoteSelf }
  | { ok: false; status?: number; error: string };
