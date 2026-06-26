# アイキャッチ画像生成の方式比較（AI Engine 再検討）

**目的**: 記事内容から**アイキャッチ画像を生成**し、WordPress の**アイキャッチ（featured image）に設定**する。

## 重要な前提（裏取り済み）

公式 **WordPress mcp-adapter（Abilities API）は、メディア関連の能力を標準で公開**している:
- **Upload media from URL**（外部画像 URL を取得してメディアライブラリへ登録・alt 付き）
- **Set featured image**（メディアを投稿のアイキャッチに設定。URL アップロード時に**自動割り当ても可**）

→ **「アイキャッチに設定する」工程は AI Engine 無しで完結する。** よって本当の分岐点は「**画像をどこで生成するか**」だけ。工程を分解すると:

| 工程 | 担当の選択肢 |
|------|-------------|
| ① 画像の**生成** | AI Engine（WordPress 内）／ 画像生成専用 MCP サーバー（Claude 側）|
| ② メディア登録＋アイキャッチ設定 | **mcp-adapter が標準対応**（どちらの方式でも共通）|

## 方式 A: AI Engine（Meow Apps）でサイト内生成

各 WordPress サイトに AI Engine を導入し、**サーバー内で画像生成**（OpenAI / GPT Image 等）してアイキャッチに設定。AI Engine 自身も MCP サーバーを内蔵する。

- **長所**: WordPress 内で完結。画質設定 UI 等が plugin 側に揃っている。WordPress 7 の AI コネクタ管理とも統合。
- **短所**:
  - **サイトごとにプラグイン導入**が必要（運用が増える）
  - **サイトごとに OpenAI 等の API キー**を設定（キーが各サイトに分散）
  - 生成コストは各サイト管理者負担
  - 「依存は最小限・config マネージャーに徹する」([ADR-0003](./adr/0003-config-manager-boundary.md)) の方針と逆方向

## 方式 B: 画像生成専用 MCP サーバー（Claude 側）

Claude Desktop に「画像生成 MCP サーバー」を1つ設定（API キーは **Claude config に1つだけ**）。Claude が記事内容から画像を生成 → 生成画像の URL を、**mcp-adapter の「URL からアップロード＋アイキャッチ設定」**で各サイトに取り込む。

- **長所**:
  - **画像生成を各 WordPress サイトから切り離せる**（プラグイン追加不要）
  - **API キーは1つ**（ユーザーの Claude 環境に集約・サイトに分散しない）
  - 本アプリの役割と完全に合致 ── §12.1 の「画像生成 MCP の**設定サポート**」＝ config に画像生成サーバーのエントリを足すだけ（mcp-wordpress-remote と同じ要領）
  - ([ADR-0003](./adr/0003-config-manager-boundary.md)) の思想に沿う
- **短所 / 要確認**:
  - 適切な画像生成 MCP サーバーの選定（既存のものを採用 or 推奨）
  - 生成画像が**フェッチ可能な URL** であること（mcp-adapter の「upload from URL」が前提。OpenAI Images は一時 URL or base64 を返すため、一時 URL の有効期限・到達性を要確認。base64 のみの場合は別途アップロード経路が要る）

## 比較表

| 観点 | A: AI Engine | B: 画像生成 MCP サーバー |
|------|:---:|:---:|
| 画像生成の場所 | WordPress サーバー内 | Claude 側（クライアント） |
| プラグイン追加 | **サイトごとに必要** | 不要 |
| API キーの管理 | **サイトごと**に分散 | Claude config に**1つ** |
| アイキャッチ設定 | 可 | 可（mcp-adapter 標準） |
| 本アプリの関与 | 設定支援は薄い | **config 設定支援がそのまま価値**になる |
| ADR-0003 整合 | ✕（サイト依存増） | ◎ |
| 向くユーザー | WordPress 内で完結させたい人 | 複数サイトを横断運用する人 |

## 推奨

**方式 B（画像生成専用 MCP サーバー）を基本線に推奨。** 「画像生成は Claude 側の MCP、アイキャッチ設定は mcp-adapter 標準能力」で、**サイトごとのプラグイン・キー分散を避けられ**、本アプリの「config マネージャー」としての役割（設定サポート）が最も活きる。AI Engine は「各サイトで完結させたい／既に AI Engine を使っている」ユーザー向けの**選択肢として併記**する。

いずれにせよ本アプリの実装は「**選んだ画像生成 MCP サーバーのエントリを `claude_desktop_config.json` に設定支援する**」ことであり、生成エンジン自体は同梱しない。

## 確定前に詰めること

1. mcp-adapter のメディア能力の**正確な ability 名・有効化条件**（バージョン依存の有無）を実機で確認。
2. 画像生成 MCP サーバーの**具体候補**（OpenAI Images 系・Stability・Replicate 等のラッパー）と、出力が「URL か base64 か」「URL の有効期限・到達性」。
3. base64 出力しか得られない場合の取り込み経路（一時ホスティング or mcp-adapter 側の base64 受け口の有無）。
4. 横長・写真風などの**スタイル指定**の渡し方（プロンプト規約）。
5. コスト/モデル選定（既定の画像モデル）。

## Sources

- [WordPress/mcp-adapter（Abilities API・media/featured 能力）](https://github.com/WordPress/mcp-adapter)
- [From Abilities to AI Agents: WordPress MCP Adapter（developer.wordpress.org）](https://developer.wordpress.org/news/2026/02/from-abilities-to-ai-agents-introducing-the-wordpress-mcp-adapter/)
- [AI Engine（Meow Apps・MCP/画像生成）](https://meowapps.com/ai-engine/)
- [AI Engine（WordPress.org プラグイン）](https://wordpress.org/plugins/ai-engine/)
