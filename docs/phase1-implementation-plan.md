# WP MCP Manager — Phase 1 実装プラン

対象: 仕様書 v1.2 の **Phase 1（コア）**。前提となる決定は [ADR-0001〜0005](./adr/) と [CONTEXT.md](../CONTEXT.md) を参照。

---

## 0. アーキテクチャ方針

### プロセスモデル（Electron）

セキュリティクリティカルな処理（認証情報・config 書き込み・WordPress 通信）は **main プロセスに集約**し、renderer からは contextBridge 経由の細い IPC API だけを公開する（7章: contextIsolation / 平文を renderer に渡さない）。

```
renderer (React)  ──IPC（contextBridge）──▶  preload  ──▶  main
  画面・状態                                  型付き API     services（下記）
  認証情報の平文は持たない                                   electron-store / safeStorage / fetch / fs
```

**原則:**
- アプリケーションパスワードの平文は **renderer に一切渡さない**。入力時は「保存」IPC で main に送って即 safeStorage 暗号化、以降 renderer は持たない。表示はマスク（`••••`）のみ。
- WordPress への REST / MCP 通信は **main の fetch** で行う（CORS 回避・認証情報を renderer に出さない）。
- `claude_desktop_config.json` の読み書きは main の `fs` のみ。

### 技術選定（推奨）

| 項目 | 採用 | 備考 |
|------|------|------|
| 雛形・ビルド | **electron-vite** + electron-builder | main/preload/renderer を Vite で。HMR・TS 標準対応 |
| UI | React + TS + shadcn/ui + Tailwind CSS v4 | 仕様 3章どおり |
| クライアント状態 | Zustand（軽量）+ React Query（非同期: 疎通・サマリー取得） | 過剰な状態管理を避ける |
| 永続化 | electron-store（設定）/ safeStorage（秘密） | 仕様 6章どおり |
| i18n | react-i18next（ja のみ） | 文字列はハードコードしない |
| テスト | Vitest（main ロジック中心）/ Playwright-electron（任意・Phase 2） | configWriter を重点テスト |
| パッケージ管理 | pnpm（npm でも可） | — |

---

## 1. モジュール分割（main プロセス services）

| モジュール | 責務 | 依存 |
|-----------|------|------|
| `siteStore` | サイト設定（6.1）の CRUD。electron-store ラッパ。`order`・`enabled`・`secretUpdatedAt` 等を管理 | electron-store |
| `secretStore` | アプリケーションパスワードの safeStorage 暗号化/復号（6.2）。`secrets.<id>` を Base64 で保存 | safeStorage, electron-store |
| `wpClient` | WordPress REST 疎通（`/wp-json/wp/v2/posts` GET、投稿数・下書き数取得） | fetch |
| `mcpClient` | MCP `initialize` ハンドシェイク（5.3.1）、`serverInfo.version` 取得 | fetch |
| **`configWriter`** | **`claude_desktop_config.json` の安全な読み書き（最重要・下記 §2）** | fs |
| `claudeDesktop` | Claude Desktop の検出・パス解決（OS別・4.3）、再起動（確認付き・5.2.2） | fs, child_process |
| `entitlement` | Free/Pro ゲートの**構造**のみ（強制なし・ADR-0004）。単一の `can(feature)` 入口 | — |
| `logger` | 操作ログ（5.4.2 は Phase 2 だが、基盤の記録口だけ用意） | electron-store |

**実装進捗（TDD・main コア＋IPC 契約＝完了）:** 8サービスすべて参照実装＋ゴールデンテスト済み（**計 74 テスト全緑・`tsc --noEmit` 通過**）。
`configWriter`(17)・`siteStore`(15)・`secretStore`(10)・`wpClient`(7)・`mcpClient`(6)・`entitlement`(7)・`claudeDesktop`(6)・`logger`(6)。
OS/ネットワーク/Electron 依存（safeStorage・fetch・platform・env・process・clock・backend）はすべて**インターフェース注入**で Electron 非依存にテスト可能。config パス解決は `claudeDesktop` に一本化。
**IPC 境界の型確定:** `src/shared/domain.ts`（単一の源）＋ `src/shared/ipc.ts`（`IpcApi`＝`window.api`・チャンネル定数・結果型）。`entitlement`/`logger` の列挙は shared に一本化済み。

**オーケストレーション層（`AppService`）＝実装済み:** 8サービスを束ね、IpcApi 各メソッドに対応する多段フロー（接続＝秘密取得→config 書き込み→状態永続化→ログ／削除＝config・秘密・レコード一掃／test・sync→サマリー＆health キャッシュ→Site DTO 組み立て）を実装。**実サービス＋フェイク依存の統合テスト 13 件**で検証（接続→再起動で `connected_pending_restart`→`connected_active`、key_collision、secret_missing で config 不書き込み 等）。Electron 非依存。

**M0 雛形＝実装済み（electron-vite）:**
- `electron.vite.config.ts`・`src/main/index.ts`（BrowserWindow・contextIsolation 有効/nodeIntegration 無効）・`src/main/realDeps.ts`（本物の safeStorage/fetch/electron-store/child_process/shell を各サービスへ注入）・`src/main/ipc/registerHandlers.ts`（`IPC_INVOKE`→`AppService`）・`src/preload/index.ts`（contextBridge で `window.api`）・`src/renderer/`（React + Tailwind v4・ダークモード class 戦略・サイト一覧/Claude 検出/config パス表示の最小 UI）。
- **検証: `npx electron-vite build` が main/preload/renderer の3バンドルとも成功（`out/main/index.js`・`out/preload/index.mjs`・`out/renderer/`）。`tsc --noEmit` 通過・87 テスト緑を維持。**
- **GUI 実起動を実機で検証済み（2026-06-25）:** `npm run dev` で Electron ウィンドウが起動し、`window.api.sites.list()` / `claude.detect()` / `claude.configPath()` / `settings.get/update` の疎通を確認。preload→IPC→AppService→本物依存（electron-store/safeStorage/child_process）まで一気通貫で動作。

**M1 本格 UI＝実装済み（React + Tailwind v4）:** `src/renderer/` に状態層（`state.tsx`: window.api 越しの全アクション＋トースト）と画面を実装。
- `Sidebar`（サイト一覧・カラーバッジ・D&D 並べ替え・追加・設定/ログ導線）
- `SiteDetail`（サマリー3カード・同期/編集/ブラウザでログイン・接続設定・接続トグル＋再起動待ち表示・削除）
- `SiteDialog`（追加/編集・**最小権限/90日ローテーションのインラインヒント**・テストと保存を分離・HTTP 警告・重複名エラー表示）
- `SettingsView`（テーマ/間隔/保持日数/警告閾値/config パス）・`LogView`（操作ログ閲覧）
- 共通プリミティブ `ui.tsx`（Button/Card/Badge/Modal/Field/Toggle/Select）・Claude 未検出バナー・再起動推奨トースト
- **検証: `tsc --noEmit` 通過・87 テスト緑維持・`electron-vite build` 成功（renderer 244KB JS / 23KB CSS）。GUI 目視はローカルの `npm run dev` で実施。**

**i18n 基盤＝実装済み（react-i18next・§8.5）:** `src/renderer/i18n/`（`ja.ts` リソース＋`index.ts` 初期化＋`Intl` の日付/数値ヘルパ）。全 renderer 文字列を ja リソースへ外出し、ハードコード排除。main が返す reason コード（duplicate_name / key_collision / secret_missing / encryption_unavailable 等）を renderer でローカライズ（素のメッセージにフォールバック）。将来 `en` 等を同形で追加可能。日付/数値は `Intl`（`ja-JP`）で一元化。

**進捗合計: ロジック 9 ファイル・87 テスト全緑＋ M0/M1/i18n（Electron 起動・本格 UI・国際化基盤）ビルド成功・`tsc --noEmit` 通過。Phase 1 のスコープを完了。**

**Phase 1 残（任意/Phase 2 寄り）:** shadcn/ui への置換（現状は同等の自前プリミティブで機能充足）・`events` プッシュ配線（バックグラウンド監視・自動トースト＝Phase 2）・言語切替 UI と en リソース（Phase 3）・JWT 認証の有効化（Phase 2）。実行: `npm test`／`npm run build`／`npm run dev`。

---

## 2. configWriter（最重要モジュール）

`claude_desktop_config.json` は **他アプリ所有のファイル**であり、破損は他の MCP 設定を巻き込む。最優先で堅牢に作り、ゴールデンテストで固める。

### 書き込みアルゴリズム

1. 既存ファイルを読む。**パース失敗時は上書きせず中断**し警告を返す（5.2.1: 破損保護）。
2. ファイル/ディレクトリ不在時は `{ "mcpServers": {} }` から新規作成（5.2.1）。
3. 対象サイトのエントリを組み立てる:
   - `WP_API_URL` = サイト URL ＋ `mcpEndpoint`
   - `WP_API_USERNAME` / `WP_API_PASSWORD`（secretStore から復号）
   - `OAUTH_ENABLED: "false"`
   - **`WP_MCP_MANAGER_ID: <内部 uuid>`**（自社エントリ識別・ADR-0001）
   - `args` のバージョンは **ピン留め**（`@latest` 禁止・5.2.1）
4. **他アプリの `mcpServers` エントリは保持**し、自社エントリ（`env.WP_MCP_MANAGER_ID` 一致）のみ追加/更新/削除。
5. **キー名衝突チェック**: 表示名キーが「自社以外の既存キー」と衝突するなら**接続をブロックして警告**（ADR-0001）。
6. **アトミック書き込み**: 一時ファイルへ書く → `.bak` を1世代退避 → rename（5.2.1）。

### 操作 API

- `connect(siteId)` … エントリ追加。`enabled=true`, `connectedAt` 記録。
- `disconnect(siteId)` … エントリ削除（`env.WP_MCP_MANAGER_ID` で特定）。
- `updateConnected(siteId)` … 接続中サイト編集時に更新。改名は「旧キー削除＋新キー追加」。
- `removeAllOwned()` … アンインストール準備（macOS）/アンインストールフック（Windows・ADR-0005）。

### テスト（Vitest・ゴールデン）— **実装済み（TDD 完了）**

参照実装: `src/main/services/configWriter/configWriter.ts`
ゴールデンテスト: `src/main/services/configWriter/configWriter.test.ts`（**17 ケース全緑・`tsc --noEmit` も通過**）。実ファイル（一時ディレクトリ）に対して検証する。

- 新規作成（ファイル不在 → `{mcpServers:{}}` から作成・新規時は .bak を作らない）
- エントリ内容（npx・完全固定バージョン・`OAUTH_ENABLED=false`・`WP_MCP_MANAGER_ID`・`^`/`~` 不使用）
- 既存の他 MCP 設定とトップレベルキーを**壊さず保持**
- 破損 JSON / トップレベル配列で**中断**（上書きせず `parse_error`）
- キー衝突をブロック（他アプリの同名キー）／自社同名は冪等更新
- 改名 = 旧キー削除＋新キー追加（他エントリ不変）
- disconnect / removeAllOwned は `env.WP_MCP_MANAGER_ID` で特定（手動改名されても追跡）
- アトミック書き込み（.bak に直前内容を退避・`.tmp-*` を残さない）

> 実行: `npm install && npm test`（Vitest）。

---

## 3. IPC API サーフェス（preload / contextBridge）

renderer に公開する型付き API（平文は返さない）:

```ts
window.api = {
  sites: { list, get, create, update, remove, reorder },         // siteStore
  secret: { set(siteId, appPassword), has(siteId) },             // 平文は set だけ。get は無し
  test:   { run(siteId | draftSite) },                           // REST + MCP initialize（5.3.1）
  sync:   { run(siteId) },                                       // サマリー再取得（読み取り専用・Free）
  connect:{ on(siteId), off(siteId) },                           // configWriter
  claude: { restart(), detect(), configPath() },                // 確認ダイアログは renderer 側
  app:    { settings: { get, set }, openExternal(url), entitlement: { can } },
}
```

---

## 4. 画面（renderer / 8章）

- **メイン画面**: 左サイドバー（サイト一覧・カラーバッジ・追加ボタン・設定/ログ導線・D&D 並べ替え）＋右詳細パネル（サマリー・ボタン列〔同期/編集/ブラウザでログイン/Claude に接続〕・接続設定・接続トグル＋再起動待ちサブ状態表示）
- **サイト追加/編集ダイアログ**: 入力フィールド ＋ **最小権限・90日ローテーションのインラインヒント常時表示**（5.1.1）＋「接続テスト」と「保存」を分離（失敗でも警告付きで保存可）
- **設定画面**: 疎通間隔・テーマ（Light/Dark/System）・トレイ常駐・ログ保存日数・接続継続警告閾値・config パス表示＋「ファイルを開く」
- **共通**: ダークモード（Tailwind class 戦略・shadcn トークン）、i18n（ja リソース・`Intl` で日付/数値）

---

## 5. 実装順序（マイルストーン・依存順）

| M | 内容 | 依存 | 完了条件 |
|---|------|------|----------|
| **M0** 基盤 | electron-vite 雛形、contextIsolation/preload 配線、Tailwind v4 + shadcn、ダークモード、i18n 骨組み、空ウィンドウ | — | 起動してテーマ切替が効く |
| **M1** データ＆CRUD | siteStore / secretStore、サイト追加・編集・削除 UI、サイドバー一覧、D&D 並べ替え、インラインヒント | M0 | サイトを保存/編集/削除でき、平文が renderer に出ない |
| **M2** 疎通 | wpClient（REST）/ mcpClient（initialize）、接続テスト、ステータスバッジ、同期（サマリー再取得） | M1 | テスト/同期で投稿数・MCP バージョン・バッジが出る |
| **M3** config 連携（核） | **configWriter**（§2 全項目＋ゴールデンテスト）、接続トグル、再起動通知＋待ち/反映済みサブ状態、claudeDesktop 検出 | M1（M2 と並行可） | 接続/解除で config が安全に増減し、他設定を壊さない |
| **M4** 仕上げ | ブラウザでログイン、secretUpdatedAt ＋ 90日ローテーション警告、自動再起動（確認＋デバウンス）、設定画面、アンインストール準備（removeAllOwned） | M2, M3 | 一連のワークフローが通る |
| **M5** ゲート＆配布準備 | entitlement の構造（強制なし）、HTTPS 警告、NOTICES 同梱、electron-builder 設定の土台 | M4 | フラグで上限を効かせられる状態（OFF のまま） |

> M3 が最大リスク。M2 と並行で着手し、ゴールデンテスト先行（TDD）で組むのを推奨。

---

## 6. セキュリティ実装チェックリスト（7章 / 横断）

- [ ] 平文アプリパスワードは renderer に渡さない（set 系 IPC のみ・get 無し）
- [ ] safeStorage 暗号化（`isEncryptionAvailable()` false 時の扱い → §8 未決）
- [ ] HTTP URL 登録時に警告（HTTPS 推奨）
- [ ] config はアトミック書き込み＋.bak＋破損時中断
- [ ] 自社エントリは `env.WP_MCP_MANAGER_ID` でのみ識別
- [ ] 最小権限（Editor）・90日ローテーションのインラインヒント
- [ ] アンインストール: Windows フック / macOS 準備ボタン（ADR-0005）

---

## 7. テスト戦略

- **Vitest（重点: configWriter）** — §2 のゴールデンケース。merge/preserve/collision/corruption/atomic。
- **Vitest（services）** — secretStore の暗号化往復、wpClient/mcpClient のレスポンス整形（fetch はモック）。
- **手動/Playwright-electron（任意）** — 接続→再起動→解除の E2E は Phase 2 で自動化。

---

## 8. 未決事項（実装前に確定したい）

1. ~~**safeStorage 利用不可環境の扱い**~~ **【確定】** 平文フォールバックは取らず縮退対応。起動時 `isEncryptionAvailable()` が false なら警告バナーを常時表示し、認証情報に依存する操作（アプリパス保存・接続トグル ON・接続テスト）のみ無効化（アプリ全体はブリックさせない）。復号失敗（鍵変更等）したサイトは「認証情報の再入力が必要」状態にして再接続を促す。回復したら自動で再有効化。
2. ~~**90日ローテーション警告の Free/Pro 区分**~~ **【確定】** Free（セキュリティ機能は全 Free の方針・12章）。「24h 接続継続警告（露出時間の自動監視）= Pro」とは別物として区別。
3. ~~**mcp-wordpress-remote のピン留めバージョン**~~ **【確定】** 初期ピン = `@automattic/mcp-wordpress-remote@0.3.5`（現最新・ただし 0.x プレリリースのため M2/M3 で実機スモークテスト〔initialize・投稿 CRUD・公開・メディアアップロード〕を通してから配布版に固定）。**完全固定**で書く（`^`/`~` 禁止＝0.x はマイナーでも破壊的変更あり）。バージョンはアプリ設定で集中管理し、全 config 生成がそこを参照（将来の更新通知の単一真実源）。昇格スモークテストのチェックリストを運用し、既定ピン更新前に必ず通す。
4. ~~**接続テストの MCP `initialize` 詳細**~~ **【確定】** MCP エンドポイントに直接 POST（プロキシ非経由）。ヘッダ `Content-Type: application/json` / `Accept: application/json, text/event-stream` / `Authorization: Basic base64(user:appパス)`。ボディは JSON-RPC 2.0 `initialize`（`protocolVersion`・空 `capabilities`・`clientInfo`）。応答は **JSON / SSE 両対応**でパースし `result.serverInfo.version` を「MCP アダプターバージョン」として表示。**initialize のみで使い捨て**（`notifications/initialized`・セッション維持は不要）。**版ネゴシエーション**（サーバー返却版を受容）＋版不一致時は1段古い既知版でフォールバック。protocolVersion の具体値・Basic 認証可否・SSE 返却有無は M2/M3 スモークで実機確認。
5. **アイコン・署名情報** — Phase 4 配布の前提（Developer ID / Azure Artifact Signing）だが、ビルド設定の土台は M5 で用意。
