# note.com 取り込みとマルチプラットフォーム化（同梱の限定解禁・アプリ常駐 MCP サーバー）

本アプリを「WordPress 専用」から「**マルチプラットフォーム投稿管理**」へ拡張し、note.com 対応のために **第一級の TypeScript 製 note MCP サーバーをアプリに同梱**する。これは [ADR-0003](./0003-config-manager-boundary.md)（config マネージャーに徹し、自社で MCP サーバーを同梱しない）の **限定的な例外**であり、その境界条件をここで定義する。

## 背景

- 「WordPress 以外の投稿管理」はアプリの魅力を大きく広げる。最有力候補が note.com。
- ただし note.com には**公式 API が無い**。参考実装 [drillan/note-mcp](https://github.com/drillan/note-mcp)（MIT）は **Python ＋ Playwright（ブラウザログイン）** で、本アプリの **Node/Electron** スタックと不一致。Python/uv/Playwright の前提を利用者に課すのは重い。
- 調査の結果、note-mcp の**中核（下書き作成/更新/公開/一覧/削除・画像・埋め込み）は純 HTTP API**で、ブラウザが要るのは**ログインとプレビュー**のみと判明。よって TypeScript へ移植し、**ログインは Electron `BrowserWindow` で代替**すれば、Python も Playwright も不要で Node 単一に収まる。
- ADR-0003 が避けたい本質は「**OAuth 認可サーバー等、公式エコシステムが提供すべきものを自作・保守すること**」。note は公式エコシステムが存在しないため、第一級サーバーの同梱を**例外として認める**判断に至った。

## 決定

### ドメイン拡張（用語は [CONTEXT.md](../../CONTEXT.md)）
- 最上位概念を **投稿先**（プラットフォーム非依存）に一般化。各投稿先は **プラットフォーム**（`wordpress` / `note`）を持つ。「サイト」は WordPress 投稿先の下位語として残す。
- note は「接続（config 軸）」と独立に「**ログイン中／要再ログイン**」（アプリが有効な note セッションを保持するか）の軸を持つ。

### アーキテクチャ（D 案：アプリ常駐 MCP サーバー）
Claude Desktop の `claude_desktop_config.json` は **stdio 専用**（`url`/`type` を拒否）であることを裏取り済み。よって D を次の形で実現する:
- アプリが **note MCP サーバーを内部で常駐ホスト**（localhost・Streamable HTTP）。**note セッションはアプリ内に留まる**（Electron `BrowserWindow` でログイン → 既存 `safeStorage` で暗号化保存）。
- Claude が起動するのは **自前同梱の極小 stdio ブリッジ**。config エントリは bridge の `command`/`args` と、`env` に **localhost URL ＋ アプリ発行のローカルアクセストークン**のみ。
- → **note の認証情報（セッション Cookie＝乗っ取り級）は config に一切出ない**。config に乗るのは localhost 限定・回転可・非アカウントのローカルトークンだけ。

### 責務境界・スコープ
- アプリは note 投稿先の **登録・接続・ログイン・状態表示**に徹する（WordPress と同じ）。**記事の作成/編集は Claude が note MCP ツール経由で行う**。記事/下書きはアプリの第一級用語にしない。
- **v1 ツール（7）**: create_draft / update_article / get_article / list_articles / publish_article / delete_draft / upload_eyecatch。本文画像・埋め込み・プレビュー・ファイル取込・一括削除は v2 以降。

### 収益・リスク
- **note 対応は Pro 機能**（entitlement に `platform.note` 等を追加）。enforcement は [ADR-0004](./0004-entitlement-gate-deferred-enforcement.md) どおり当面 OFF＝全員利用可、課金本稼働時にゲート。
- **非公式 API を意識的に受容**: 初回 note セットアップ前に一度だけ**ディスクレーマ＋明示同意**（非公式API・予告なく壊れうる・ToS/アカウント責任は利用者・サポートはベストエフォート）。UI で note 対応を**ベータ/実験的**と明示。WordPress（公式 mcp-adapter）とは信頼性の階層が違うことを伝える。
- **保守はこちらで引き受ける**（note.com 仕様変更への追従修正を継続する commitment）。

## ADR-0003 との関係

ADR-0003 の原則は維持する ── **WordPress は引き続き config 管理のみ**（自社プラグイン/認可サーバーを持たない）。本 ADR はその境界に**例外条件**を1つ加える:

> **公式の MCP/連携エコシステムが存在しないプラットフォームに限り、第一級の MCP サーバーをアプリに同梱しうる。** ただし秘密はアプリ内に留め config に出さない（D 案）、非公式 API は明示同意＋ベータ表示で受容、保守責任を負う、を満たすこと。

## 却下した代替案

- **B 案（セッションを config の env に注入）**: WordPress と同じ手口で最小実装だが、note セッションは**乗っ取り級**で、平文で config に置くのは WordPress の Application Password より明確にリスクが高く却下。
- **C 案（OS キーチェーン共有でサーバーへ受け渡し）**: config 平文は避けられるが、[ADR-0007](./0007-secret-delivery-to-claude-desktop.md) で論じたクロスプラットフォームのキーチェーン配管（Win/Linux 差）を抱えるため、アプリ常駐前提なら D の方が単純で安全。
- **Python note-mcp を config からそのまま起動**: 最速だが Python/uv/Playwright を利用者に課す。Node 単一の体験を損なうため却下（ただし将来の比較対象として残す）。
- **素の localhost HTTP URL を config に直書き**: Claude Desktop が stdio 専用のため不可。

## Consequences

- **保守負担**: 非公式 note API クライアントを自社保有＝note 仕様変更の追従が継続コスト（受容済み）。
- **アプリ常駐が前提**: note ツールはアプリ起動中のみ機能。本アプリはトレイ常駐前提のため許容。未起動時は「要再ログイン/アプリ未起動」を Claude 側で失敗として扱う。
- **新コンポーネント**: アプリ内 note MCP サーバー＋同梱 stdio ブリッジ＋Electron ログイン UX＋セッション管理（失効検知・要再ログイン表示）。
- **見積もり（フル）**: P1 ログイン疎通 → P2 中核CRUD → P3 markdown→note HTML 忠実度（最難所）→ P4 画像/埋め込み → P5 プレビュー/残ツール → P6 結線/テスト/同梱。実検証ループ律速でおおむね 10〜15 集中セッション。v1（7ツール）は P1+P2 中心で早期に実用到達。
