# note.com 取り込み 実装プラン（ADR-0008）

前提・決定は [ADR-0008](./adr/0008-note-integration-multiplatform.md) と [CONTEXT.md](../CONTEXT.md)。本書は実装の段取り（モジュール構成・フェーズ・IF）を定める。原則：**note 中核は Electron から切り離した独立パッケージ**にし、「アプリ同梱」と「単体 MIT 公開」を両取りする。

## 1. 全体アーキテクチャ（D 案の実体）

```
Claude Desktop
   │ stdio（config: command=node, args=[bridge], env=URL+localToken）
   ▼
note-bridge（同梱・極小 stdio↔HTTP 中継）
   │ localhost HTTP（Streamable HTTP）＋ Bearer localToken
   ▼
アプリ常駐 note MCP ホスト（Electron main 内）
   ├─ note-core（独立パッケージ）… note API クライアント＋7ツール＋markdown変換
   └─ セッション供給（Electron BrowserWindow ログイン → safeStorage）
```

- **note 認証情報（セッション Cookie）は config に出ない**。config に乗るのは localhost URL＋ローカルトークン（アプリ発行・回転可・非アカウント）。
- アプリ常駐が前提（トレイ常駐）。未起動/未ログイン時、bridge は Claude へ「要ログイン/未起動」エラーを返す。

## 2. リポジトリ構成

```
packages/note-core/            ← 独立パッケージ（MIT 公開候補・Electron非依存）
  src/
    client.ts                  note.com HTTP クライアント（session 注入式）
    tools.ts                   7 ツールの定義＋ハンドラ（MCP SDK）
    markdown/toNoteHtml.ts     markdown→note専用HTML（最難所・移植元 utils/markdown_to_html.py）
    markdown/fromNoteHtml.ts   note HTML→markdown（get_article 用）
    images.ts                  presigned アップロード（eyecatch）
    models.ts                  型
  package.json                 @modelcontextprotocol/sdk 等
src/main/note/                 ← アプリ統合（Electron依存）
  host.ts                      localhost MCP ホスト（note-core を載せる）＋localToken
  login.ts                     BrowserWindow ログイン→Cookie取得→safeStorage
  session.ts                   セッション保存/失効検知/要再ログイン状態
  bridge/note-bridge.mjs       同梱 stdio↔HTTP ブリッジ（Claude が起動）
```

note-core は session を「外から渡される」設計（`createNoteClient({ getSession })`）にして、アプリは Electron ログイン由来の session を注入。単体公開版は自前ログイン手段を別途同梱できる。

## 3. ドメインモデルの一般化（最大の非note作業）

現状 `src/shared/domain.ts` は WordPress 中心（`SiteRecord`: url/username/authMethod）。これを**投稿先＋プラットフォーム**へ一般化する。

```ts
type Platform = 'wordpress' | 'note';
interface PostTargetBase { id; name; platform; enabled; order; connectedAt?; createdAt; memo?; }
interface WordPressTarget extends PostTargetBase { platform:'wordpress'; url; username; authMethod; ... }
interface NoteTarget extends PostTargetBase { platform:'note'; noteUserId?; loginState:'logged_in'|'needs_relogin'; }
type PostTarget = WordPressTarget | NoteTarget;
```

影響：`siteStore`（→ targetStore へ一般化 or 内部分岐）、`configWriter`（note は bridge エントリを書く分岐）、IPC 型、renderer（投稿先タイプ選択・一覧表示）。**既存 WordPress 挙動は不変**を回帰テストで担保。

**P0 の実装方針（2026-07-02・土台完了）**: 全面 rename ではなく**加法的**に土台を敷いた。`src/shared/domain.ts` に `Platform`/`NoteLoginState`/`PostTargetBase`/`WordPressTarget`(=`Site & {platform:'wordpress'}` でロスレス)/`NoteTarget`/`PostTarget` union を追加。判別ロジックは `src/shared/postTarget.ts`（`isWordPressTarget`/`isNoteTarget`/`siteToWordPressTarget`/`wordPressTargetToSite`・ユニット5件）。**既存 `Site`/`SiteRecord`・siteStore・renderer・IPC は無変更**＝回帰ゼロ（全145件グリーン）。store/configWriter/UI の union 採用は note 機能が実際に UI/config に出る **P5/P6** で段階適用する（今やると WordPress 動作を広範に触るため）。

## 4. コンポーネント詳細

### 4.1 note-core（独立）
- `client.ts`: `https://note.com/api` への httpx 相当（fetch）。エンドポイントは note-mcp から写経：下書き保存 `v1/text_notes/draft_save`、ノート `v3/notes/`・`v1/notes/n/`、一覧 `v2/note_list/contents`、eyecatch `v1/image_upload/note_eyecatch`、本文画像 `v3/images/upload/presigned_post`。
- `tools.ts`: v1 の7ツールを MCP SDK で定義。
- `markdown/`: note 専用 HTML 変換。**ここが品質の肝**（移植元 826 行）。段階的に忠実度を上げる。

### 4.2 アプリ統合（Electron）
- `login.ts`: `BrowserWindow` で `https://note.com/login` を開く→ログイン完了を検知→`session.cookies.get()` で Cookie 取得→`safeStorage` 暗号化保存。
- `session.ts`: 保存/読み出し、API 401 等での失効検知→`loginState='needs_relogin'`、UI へ通知。
- `host.ts`: Electron main 内で localhost Streamable HTTP MCP サーバーを起動（note-core をマウント）。起動時にランダム port＋localToken 発行。`Authorization: Bearer` 検証。
- `bridge/note-bridge.mjs`: stdin/stdout の MCP メッセージを localhost HTTP へ中継（外部依存ゼロ）。

### 4.3 configWriter 拡張
- note 接続時：`{ "command":"node", "args":["<同梱>/note-bridge.mjs"], "env":{ "NOTE_BRIDGE_URL":..., "NOTE_BRIDGE_TOKEN":... } }` を識別マーカー付き（[ADR-0001](./adr/0001-site-identity-in-claude-config.md) と同様）で書く。WordPress 同様アトミック書込・衝突回避。

### 4.4 IPC / UI
- 追加 IPC：`note.login()` / `note.logout()` / `note.loginState()`、`targets.*`（既存 sites.* の一般化）。
- UI：投稿先追加時に**プラットフォーム選択**（WordPress / note）。note は URL/パスワード欄でなく「note にログイン」ボタン＋状態（ログイン中/要再ログイン）。初回 note 設定前に**ディスクレーマ＋同意**（ADR-0008）。Pro バッジ・ベータ表示。

## 5. 認証・セッションライフサイクル
1. 投稿先（note）追加 → 同意 → 「note にログイン」→ BrowserWindow → Cookie 取得 → safeStorage。
2. 接続 ON → config に bridge エントリ → Claude 再起動。
3. Claude が note ツール使用 → bridge → アプリ host → note-core が session で API。
4. session 失効（API 401）→ `needs_relogin` 表示 → 再ログインで回復。
5. アンインストール時の config 掃除は [ADR-0005](./adr/0005-plaintext-cleanup-on-uninstall.md) と同枠（note は config に秘密が無い分リスク低）。

## 6. フェーズ

| Ph | 目的 | 主タスク | 目安 |
|----|------|---------|------|
| P0 | ドメイン一般化 | ✅**土台完了(2026-07-02)** PostTarget union＋型ガード＋アダプタ。store/configWriter 分岐は note 着地(P5/P6)時に適用。 | 土台済 |
| P1 | ログイン疎通 | ✅**完了(2026-07-02)** BrowserWindow ログイン→永続セッション→`list_articles` 実機確認。認証判定は `/settings/account` ページ読み取り。 | 完了 |
| P2 | 中核CRUD | ✅**実装完了(2026-07-02)** create/update/get/publish/delete_draft を note-core に追加（本文はHTML直接・埋込/画像はv2）。ユニット29件。実note疎通は要ログイン時に。 | 実装済 |
| P3 | 本文HTML忠実度 | ✅**双方向 完了(2026-07-02)** markdown⇄note HTML（markdown-it＋note固有変換／逆変換は往復一致）。exotic記法(TOC/整列/株式/埋込)は残。 | 双方向済 |
| P4 | アイキャッチ | upload_eyecatch（presigned） | 1 |
| P5 | 常駐ホスト＋ブリッジ＋config | ✅**中核完了(2026-07-02)** tools/server/host/bridge/session/login/configWriter分岐/NoteService。フルチェーンe2e済。残=IPC/realDeps/renderer(P6)・Claude実機。 | 中核済 |
| P6 | UI/状態/同意＋テスト | ✅**初版(2026-07-02)** note IPC＋main配線＋NoteController＋設定画面のNoteAccount（ログイン/接続/同意/ベータ）。残=投稿先一覧統合・複数アカウントstore・Claude実機・配布バンドル。 | 初版済 |

v1 は P0〜P2＋P4＋P5＋P6 で「ログイン→下書き作成/更新/一覧/公開＋アイキャッチが Claude から動く」。P3 は忠実度を継続改善。

## 7. テスト戦略
- note-core：ユニット（fetch をフェイク注入。既存 wpClient/license と同じ DI 流儀）。markdown 変換はゴールデンテスト（移植元の期待 HTML を流用）。
- 認証/host/bridge：Electron 依存は薄く保ち、ロジックは DI でテスト（googleAuth と同様）。
- 実 note 検証：P1/P2 はあなたの実アカウントでの疎通往復が律速。

## 8. リスク・未決
- **ログイン時の bot 検知/reCAPTCHA**（P1 で実地確認 → ✅**対策が有効と実証**）: note は新規ログインに reCAPTCHA を出す。**ログインを繰り返すと一時ブロック**される（PoC で「毎回まっさら強制ログイン」をやり再現）。対策＝**(1) ログインは一度きり＋セッション永続化・再利用**（毎回ログインしない）、**(2) Electron トークンを外したクリーン Chrome UA**、(3) reCAPTCHA はユーザーが窓内で手動で1回解く（note-mcp も手動ログイン推奨）。→ **P1 で (1)(2) を実装した永続パーティション方式が有効と確認**（初回ログイン後は再ログイン不要でブロックを誘発しない）。恒常的に弾かれる懸念は解消方向だが、セッション失効後の再ログイン頻度は実運用で継続監視。
- **最難所＝note 専用 HTML 忠実度**（崩れると記事が壊れる）。段階的・ゴールデン駆動で。
- Claude Desktop の localhost HTTP MCP（bridge 経由）安定性は P5 で実機確認。
- セッション失効頻度・再ログイン UX は実運用で調整。
- **公開可否**（note-core を単体 MIT 公開するか）は P 完了後のプロダクト判断（非公式API の ToS 観点）。設計は公開可能な分離を先に確保。

## P1 完了メモ（2026-07-02・実ログイン疎通 済み）

**✅ P1 達成**: Electron `BrowserWindow`（永続パーティション `persist:note-poc`＋クリーン Chrome UA）で note.com 実ログイン→ `urlname=bungo_ai_nosuke` 確認＋ `list_articles` 7件（published, key/status/name）取得を実機で確認。**一度のログインでセッションが永続化され、次回以降は再ログイン不要**（reCAPTCHA を回避できることを実証）。PoC は `scratchpad/note-poc/main.cjs`（v5・使い捨て）。

### 確定 API 契約（実測で前回の推定を訂正）
- **認証判定（ブラウザ方式・note-mcp `browser.py` 準拠）**: `https://note.com/settings/account` を開き、① DOM `a[href="/settings/account/note_id"] > p`（= note ID＝urlname）、② `window.__NEXT_DATA__.props.pageProps.currentUser`（id/urlname）から読む。
  - ⚠ **訂正**: 前回「`GET /api/v2/self` 200 で判定」は誤り。**ブラウザ文脈では `/api/v2/self`=404、`/api/v1/stats/pv`=400** で不安定（httpx サーバー側パスとは挙動が違う）。認証判定はページ読み取りで行う。
- **ログイン時に付く Cookie**: `_note_session_v5`, **`note_gql_auth_token`**（GraphQL 認証）, `_ga`/`_ga_*`/`_gid`, `_vid_v2`, `fp`。`XSRF-TOKEN` は**変更系操作時のみ**出現（今回の GET だけでは未出現）。`_note_session_v5` は匿名でも付くため、**Cookie 有無での認証判定は不可**（＝上記ページ読み取りが正）。
- **一覧**: `GET https://note.com/api/v2/note_list/contents?page=1`（同一オリジン `fetch(credentials:'include')`、`Accept: application/json`）→ `{"data":{"notes":[{id,key,name,status,...}]}}`。`status` は `published`/`draft`。下書きのみは `?publish_status=draft&page=N`。**この API は認証済みブラウザ文脈から 200 で通る**（`/v2/self` 系とは異なり素直）。
- **base**: `https://note.com/api`（note-mcp `NOTE_API_BASE`）。GET は Cookie＋`Accept` のみ、変更系は `X-XSRF-TOKEN`（cookie `XSRF-TOKEN` の値）＋`Origin`/`Referer`/`X-Requested-With`/`Sec-Fetch-*`。

### note-core への含意
- セッション供給は「アプリがログイン UI（`/settings/account` 読み取り）で **ログイン状態＋urlname** を確定 → 全 Cookie を note-core に注入」。note-core は**渡された Cookie で API を叩くだけ**（認証判定ロジックは持たない）。`getSelf()` はアプリ側のページ読み取り結果（urlname/id）を保持する形にする。
- 参照実装 `scratchpad/note-mcp-src`（`git clone --depth 1` で再取得可、MIT）。

## note-core 抽出メモ（2026-07-02・✅ 抽出＋ユニットテスト完了）
- ✅ `packages/note-core` 作成（Electron 非依存・依存ゼロ・MIT 公開形）。`NoteClient`/`createNoteClient`（session 注入 = `getCookies()` 関数注入で再ログインにも追従）、`listArticles()`、`parseArticle()`、`getSelf()`。fetch DI は wpClient と同流儀。**ユニット14件グリーン**（実 note 応答形のゴールデン）、`tsc --noEmit` OK。tsconfig/vitest の include に `packages/*` を追加（npm workspaces は未導入＝install に手を入れない）。
- **transport 検証（実測）**: 当初「Node の `fetch`(undici) が `Cookie` を落とす」と疑ったが、**ローカル echo で Cookie 送信を確認＝落とさない**。よって Node fetch＋Cookie ヘッダで問題なし。アプリでは常駐セッションから Cookie を載せる（`session.cookies.get()` は **HttpOnly 含む**全 Cookie を返す）か、Electron `net.fetch({session, useSessionCookies})` を注入すればよい（後者は note セッションを Electron 内に留められ ADR-0008 とも整合）。
- ⚠ **実 note 認証の end-to-end 検証は未完（セッション失効で保留）**: P1 の v5 ログイン（`urlname` 確認済み）から短時間で `/settings/account` が `/login` にリダイレクト＝**セッション失効**。原因は経過時間 or **検証で多数の別プロセスから note.com を叩いたことによる無効化**の可能性大。実アプリは**単一の常駐セッション**なので churn しにくい想定。→ ライブ疎通は **P2/P5**（`host.ts` がログイン直後の生きたセッションで叩く時）に自然に実施。
- **認証系エンドポイントの補足**: `/api/v1/stats/pv` は**`filter` 必須**（無いと `400 {"error":"filter is missing"}`）。`/api/v2/self` はブラウザ/サーバー側とも 404 になりがち。→ **ログイン真値は `/settings/account` ページ読み取り**（アプリ側）で確定し、note-core の `getSelf()` は best-effort 扱い（依存しない）。

## P2 実装メモ（2026-07-02・note-core CRUD 完了）
`packages/note-core` に 5 メソッド追加（fetch DI・discriminated result・**ユニット29件グリーン**・tsc OK・全160件）:
- `createDraft(input)`: POST `/v1/text_notes`（本文なし→id/key）→ POST `/v1/text_notes/draft_save?id={id}&is_temp_saved=true`（本文）。
- `updateDraft(articleId, input)`: key は数値IDへ解決（GET `/v3/notes/{key}` → data.id）→ draft_save。応答は最小 `{result}` なので入力から再構成。
- `getArticle(key)`: GET `/v3/notes/{key}`（key 形式必須・数値不可）。`status='deleted'` は not_found。**本文は HTML のまま返す**。
- `publishArticle(key, tags?)`: 記事取得（下書きは `note_draft.body` 優先）→ PUT `/v1/text_notes/{numericId}`（`free_body`・`status:'published'`・`#tag` 形式）→ 再取得して返す。
- `deleteDraft(key, {confirm})`: 2段階。公開記事は `published_cannot_delete`。confirm時 DELETE `/v1/notes/n/{key}`。
- **変更系ヘッダ**: `X-XSRF-TOKEN`(cookie `XSRF-TOKEN`)＋`Origin:https://editor.note.com`/`Referer`/`X-Requested-With`/`Sec-Fetch-*`＋JSON時 `Content-Type`（note-mcp `_build_headers` 準拠）。
- **スコープ外（意図的）**: 本文の markdown⇄HTML 変換は **P3**（`bodyHtml` を入出力）、埋め込みキー解決・本文画像・アイキャッチは **v2/P4**。
- ⚠ **実 note 疎通は未実施**（fake fetch のユニットのみ）。変更系は `XSRF-TOKEN` cookie が要る＝editor コンテキストのログインセッションが要る。ライブ検証は note ログイン直後に host.ts / 一時ハーネスで。**破壊的操作（publish/delete）はテスト用下書きで慎重に**。

## P3 実装メモ（2026-07-02・前方変換 markdown→note HTML 完了）
`packages/note-core/src/markdown/toNoteHtml.ts`（`markdownToNoteHtml(md, {genId?})`・**ゴールデン16件**・全176件・tsc OK）:
- CommonMark ベースは **markdown-it 14**（`new MarkdownIt('commonmark').enable('strikethrough')`＝note-mcp と同条件）。note-core に依存追加（install は `--ignore-scripts`＝electron postinstall を触らない・[[electron-binary-install-workaround]]）。
- note 固有変換（note-mcp `markdown_to_html.py` 準拠）: 画像→figure(620x457)、`<li>`→`<li><p>…</p></li>`、blockquote 内改行→`<br>`、**全要素に name/id(UUID) 付与**（`<li>`/`<blockquote>` は除外）、blockquote→figure＋**引用元(— 著者/URL)を figcaption 抽出**、code block→`<pre class="codeBlock">`（language クラス除去・pre 内改行保持・他は改行除去）。
- **UUID は生成器注入**（既定 `crypto.randomUUID`、テストは決定的カウンタ）＝出力を安定化。
### 逆変換（2026-07-02・完了）
`packages/note-core/src/markdown/fromNoteHtml.ts` = `noteHtmlToMarkdown(html)`（`html_to_markdown.py` 準拠・正規表現ベース・**テスト20件**）。見出し/段落/インライン(太字/斜体/打消/コード/リンク)/リスト(ネスト対応・独自タグマッチング)/blockquote figure＋引用元復元/画像 figure/コードブロック(フェンス化)/HR/TOC/テキスト整列/実体復号。
- **往復一致を確認**（markdown→html→markdown が主要ケースで完全一致）。
- note-mcp 由来のバグを2点修正（本移植では改善）: ①inline `<code>` と code block の `<code>` を**属性許容**にして name/id 付き code を拾う ②**コードブロック復元を「全タグ除去・実体復号の後」に移動**（code 内の `<tag>` が消える／二重復号する不具合を回避）。
- **残（段階的忠実度）**: exotic 記法の**前方**未対応（`[TOC]`・整列 `->center<-`・株式 `^1234`/`$AAPL`・単独URL埋め込み(v2)）。逆方向は TOC/整列を復元可。

note-core CRUD は引き続き `bodyHtml` を入出力。**markdown⇄HTML は tools 層(P5)が挟む**（Claude の md を `markdownToNoteHtml`→`createDraft`／`getArticle` の `bodyHtml` を `noteHtmlToMarkdown`→Claude へ）。

## ライブ疎通メモ（2026-07-02・✅ 実 note.com で end-to-end 成功）
実アカウント（urlname=bungo_ai_nosuke）でログイン→生きたセッション Cookie を注入し、note-core を実 note に対して検証:
- ✅ **認証成立**: `listArticles` が実データ7件を返す。**Node fetch＋Cookie ヘッダ（HttpOnly 含む全 Cookie）で認証が通る**ことを確定（以前の 0 件は完全にセッション失効が原因だった。undici の Cookie 落としは無い）。
- ✅ **下書きライフサイクル**（作成→取得→更新→削除）が全工程成功。`createDraft` は markdown→note HTML 変換を通した本文で作成、`getArticle` の本文を `noteHtmlToMarkdown` で往復復元、`deleteDraft(confirm)` で後始末。
- 🐛 **実バグを発見・修正**: note は作成に **HTTP 201** を返すが note-core が `=== 200` のみ成功扱いで失敗していた → **2xx を成功**（`isSuccess`・note-mcp の is_success 準拠）に修正。ユニット追加（201）。
- 🔎 **XSRF-TOKEN 無しでも変更系が成功**した（`/settings/account` 経由ログインでは XSRF-TOKEN cookie が付かないが、create/update/delete とも 2xx）。＝これらのエンドポイントはセッション Cookie で足りる。`X-XSRF-TOKEN` は cookie がある時のみ送る実装なので無害。
- ⚠ **getSelf は実環境でも失敗**（pv=400 `filter is missing`／self=404）。**ログイン真値は `/settings/account` ページ読み取り**が正（既定どおり）。
- ⚠ **要確認**: `listArticles({status:'draft'})`（`publish_status=draft`）が公開記事を返した（フィルタ未適用に見える）。実害は小さいが note の当該パラメータ挙動を後日確認。
- セッションは短命なので、ライブ検証は**ログイン直後**に行うこと。検証用ハーネスは `scratchpad/note-poc/login-dump.cjs`（gitignore・cookies.json はセッション Cookie を含むため検証後に削除）。

## P5 実装メモ（2026-07-02・中核配線 完了）
ADR-0008 D の実行経路を実装・テスト。**フルチェーン e2e**（Client→stdio→bridge子プロセス→HTTP→host→note-core）が通ることを確認。
- **MCP ツール層**（`packages/note-core/src/mcp/`）: `tools.ts`=v1 6ツール（create_draft/get_article/update_article/publish_article/list_articles/delete_draft・SDK非依存の純ハンドラ・md⇄HTML変換を挟む・認証切れはアプリ側ログイン促し＝ログインはツールにしない）。`server.ts`=`createNoteMcpServer(client)`。依存に `@modelcontextprotocol/sdk`＋`zod`（`--ignore-scripts` 導入）。ユニット15＋InMemoryTransport 統合3。
- **host.ts**（`src/main/note/`・Electron非依存）: localhost Streamable HTTP MCP ホスト（stateful・JSON応答・Bearer ローカルトークン認証）。注入 NoteClient に MCP サーバーを載せる＝note セッションはアプリ内・config に出ない。統合4件（認証/listTools/callTool/401）。
- **bridge/note-bridge.mjs**: Claude が stdio で起動する透過中継（env の URL＋Bearer で host へ JSONRPC 素通し）。
- **session.ts**: `NoteSessionStore`。note Cookie を safeStorage 暗号化保存（平文非保存）。loginState/getCookies/clear/markNeedsRelogin。6件。
- **login.ts** + **electronLoginBrowser.ts**: `performNoteLogin`（純ロジック・DI・`/settings/account` の currentUser 判定・3件）＋ BrowserWindow 実装（クリーンUA＋永続パーティション）。
- **configWriter.connectNote**: bridge エントリ（`command=node, args=[bridge], env=URL＋Bearer＋MANAGER_ID`）。秘密は載せない。disconnect/removeAllOwned は共通経路。6件。既存 WordPress 不変。
- **noteService.ts**: 束ねるオーケストレータ。`login/connect/disconnect/logout/loginState/getUrlname/isHostRunning`。ホストは1回起動して再利用。7件。
- **残（P6・アプリ統合）**: IPC（`note.login/logout/loginState`・`targets.*`）／`realDeps` で NoteService を配線し起動時にホスト常駐＆config 再書込／renderer UI（投稿先タイプ選択・ログイン/要再ログイン表示・同意ダイアログ・Pro gating・ベータ表示）／note 投稿先の store 永続化／**Claude Desktop 実機疎通**。bridge の配布時バンドル（同梱パス解決）も P6/配布。

## P6 実装メモ（2026-07-02・初版：note を UI から使える状態）
- **IPC**（`ipc.ts`）: `note.status/login/logout/connect/disconnect` ＋型（NoteStatus/NoteLoginResult/NoteConnectResult）＋チャンネル。preload で公開。registerHandlers の `ExtraHandlers.note` に結線。
- **NoteController**（`src/main/note/noteController.ts`）: 「1 アプリ = 1 note アカウント」ポリシー。managerId 永続・connected フラグ・`resumeOnStartup`（起動時にログイン中＆接続中なら host URL/token を config 再反映）・dispose。DI で10件テスト。
- **realDeps.buildNoteController** ＋ main 配線: 起動時に構築＋resumeOnStartup、終了時 dispose。config は WordPress と同一の claude_desktop_config.json。
- **renderer**（`NoteAccount.tsx`・設定画面）: ログイン状態表示、ログインボタン（初回に非公式 API 同意ダイアログ）、接続トグル、ログアウト、Pro/ベータバッジ、接続後の再起動案内。i18n（note.\*）ja/en。
- **electron-vite build 通過**（main に note-core/markdown-it/SDK をバンドル）。
- **残（P6 の続き）**:
  1. **投稿先一覧への統合**（Sidebar/SiteDetail を PostTarget union で一般化し、note をサイトと並べて表示・プラットフォーム選択で追加）。現状は設定画面の単一 note セクション。
  2. **複数 note アカウント対応**（note 投稿先ストア。現状は 1 アカウント固定）。
  3. **Claude Desktop 実機疎通**（接続→Claude 再起動→note ツール実行の往復）。
  4. ~~配布バンドル~~ → ③④で対応済（下記）。残りは electron-builder 本体の設定。

### ③ Claude 実機起動の堅牢化（2026-07-02・dedce62）
- Claude Desktop は GUI アプリで PATH が限定的（`node` を見つけられないことが多い）。→ bridge を **アプリ同梱 Electron を `ELECTRON_RUN_AS_NODE=1` で node 化**して起動する。configWriter に `extraEnv`、realDeps は `nodePath=process.execPath`＋`extraEnv={ELECTRON_RUN_AS_NODE:'1'}`。
- **バンドル版 bridge を electron-as-node で起動しフルチェーン e2e が通ることを確認**（実 Claude と同方式）。
- **実機の往復確認（ユーザー操作・未実施）**: dev で `npm run dev` → サイドバー note → ログイン → 接続 → `claude_desktop_config.json` にエントリ確認 → Claude 再起動 → Claude から note ツール実行。

### ④ bridge 自己完結バンドル（2026-07-02・dedce62）
- `scripts/bundle-bridge.mjs`（esbuild）で `note-bridge.mjs` を **SDK inline の自己完結 ESM（278KB・node_modules 不要）** に。`npm run build` に `build:bridge` を組込み（出力 `out/bridge/note-bridge.mjs`）。
- `resolveNoteBridgePath`: dev=ソース bridge（SDK は node_modules）、packaged=`process.resourcesPath/note-bridge.mjs`（バンドル）。
- **配布時の残作業（electron-builder 未設定）**: electron-builder 導入時に `extraResources` で `out/bridge/note-bridge.mjs` を resources 直下へコピー。バンドルは自己完結なので asarUnpack 不要。`command=process.execPath`（packaged Electron）＋`ELECTRON_RUN_AS_NODE=1` で起動。

## 9. ライセンス
- note-mcp は **MIT**。移植部分は note-mcp の著作権＋MIT 許諾を `NOTICE`/`THIRD-PARTY` に明記。
- note-core を公開する場合は MIT（or Apache-2.0）。アプリ本体のライセンスとは独立に選べる。
