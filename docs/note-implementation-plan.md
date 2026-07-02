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
| P0 | ドメイン一般化 | PostTarget 型・store/configWriter 分岐・既存WP回帰 | 1〜2 |
| P1 | ログイン疎通 | ✅**完了(2026-07-02)** BrowserWindow ログイン→永続セッション→`list_articles` 実機確認。認証判定は `/settings/account` ページ読み取り。 | 完了 |
| P2 | 中核CRUD | create/update/get/list/publish/delete_draft | 2〜3 |
| P3 | 本文HTML忠実度 | markdown→note HTML（＋get用 逆変換） | 2〜3（最難所） |
| P4 | アイキャッチ | upload_eyecatch（presigned） | 1 |
| P5 | 常駐ホスト＋ブリッジ＋config | host.ts / note-bridge.mjs / configWriter / Claude 実機疎通 | 2 |
| P6 | UI/状態/同意＋テスト | プラットフォーム選択・要再ログイン表示・同意・Pro gating・テスト | 2〜3 |

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

## 9. ライセンス
- note-mcp は **MIT**。移植部分は note-mcp の著作権＋MIT 許諾を `NOTICE`/`THIRD-PARTY` に明記。
- note-core を公開する場合は MIT（or Apache-2.0）。アプリ本体のライセンスとは独立に選べる。
