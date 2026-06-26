# WP MCP Manager

複数のセルフホスト型 WordPress サイトを **Claude Desktop から自然言語で操作**するための、ローカルインストール型デスクトップアプリ。MCP（Model Context Protocol）の設定・管理を GUI で提供し、ユーザーが `claude_desktop_config.json` を直接編集することなく、記事の生成・推敲・複数サイトへの投稿・公開を Claude Desktop との会話で行える環境を構築します。

> Status: **Phase 1 実装済み**（コア機能・バックエンド・UI・i18n 基盤）。詳細は [docs/phase1-implementation-plan.md](docs/phase1-implementation-plan.md)。

## 主な機能（Phase 1）

- サイトの登録・編集・削除（表示名の一意性・URL 正規化・入力バリデーション）
- `claude_desktop_config.json` の安全な自動生成・更新（アトミック書き込み・`.bak`・破損保護・他アプリ設定の保持）
- Application Password 認証（認証情報は OS の安全領域に暗号化保存・平文を保存しない）
- 接続トグル（使うときだけ平文を config に書き出し露出時間を最小化・再起動待ち/反映済みのサブ状態表示）
- 接続テスト（WordPress REST 疎通 ＋ MCP `initialize` ハンドシェイク）・サイト同期
- ブラウザで管理画面を開く・ダークモード・i18n 基盤（日本語）

## アーキテクチャ

Electron の 2 プロセス構成。セキュリティクリティカルな処理（認証情報・config 書き込み・WordPress 通信）はすべて main に集約し、**平文の認証情報を renderer に渡しません**（contextIsolation・contextBridge 経由の細い IPC のみ）。

```
src/
├── shared/        ドメイン型・IPC 契約（main/preload/renderer の単一の源）
├── main/
│   ├── services/  configWriter / siteStore / secretStore / wpClient /
│   │              mcpClient / entitlement / claudeDesktop / logger
│   ├── appService/ サービスを束ねるオーケストレーション層
│   ├── ipc/       ipcMain.handle 登録
│   ├── realDeps   本物の safeStorage/fetch/electron-store/child_process を注入
│   └── index      Electron ライフサイクル・BrowserWindow
├── preload/       contextBridge で window.api を公開
└── renderer/      React + Tailwind v4 + react-i18next（UI）
```

OS / ネットワーク / Electron 依存はすべてインターフェース注入で抽象化しており、Electron なしでユニット/統合テストが可能です（**87 テスト**）。

設計上の主要な決定は [docs/adr/](docs/adr/)、用語は [CONTEXT.md](CONTEXT.md)、機能仕様は [docs/wp-mcp-manager-spec.md](docs/wp-mcp-manager-spec.md) を参照。

## 必要要件

| 項目 | 要件 |
|------|------|
| OS | macOS 12 以上 / Windows 10 以上 |
| Node.js | v22 以上 |
| Claude Desktop | Pro プラン以上を推奨 |
| WordPress | セルフホスト型・[mcp-adapter](https://github.com/WordPress/mcp-adapter) プラグイン導入 |

## セットアップ・開発

```bash
npm install          # 依存をインストール
npm run dev          # 開発起動（electron-vite・HMR）
npm run build        # 本番ビルド（main/preload/renderer）
npm test             # ユニット/統合テスト（Vitest）
npm run typecheck    # 型チェック（tsc --noEmit）
```

### トラブルシュート: `Error: Electron uninstall`

`npm install` が postinstall（Electron バイナリDL）をブロックする環境では、`npm run dev` がこのエラーで落ちます。手動で取得してください（macOS arm64 / Electron 32 の例）:

```bash
rm -rf node_modules/electron/dist node_modules/electron/path.txt ~/Library/Caches/electron
node node_modules/electron/install.js                                    # zip を取得
ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip node_modules/electron/dist
printf '%s' "Electron.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
```

## テスト

各サービスはフェイク依存を注入したゴールデンテストで不変条件を固定しています（config の破損保護・他設定保持・キー衝突ブロック・平文フォールバック禁止・版ネゴシエーション 等）。`AppService` は実サービスを組み合わせた統合テストで多段フロー（接続・削除・同期）を検証します。

## ライセンス / 注意

- 本体はクローズドソースの proprietary アプリとして配布する想定（[料金プラン](docs/wp-mcp-manager-spec.md#12-料金プランフリーミアム)）。
- WordPress / Claude / Automattic とは非公式・非提携。各ブランドガイドラインに従います。
- GPL ライセンスのコンポーネント（mcp-wordpress-remote・WordPress プラグイン）は同梱せず、実行時取得・ユーザー側導入とします（[ADR-0003](docs/adr/0003-config-manager-boundary.md)）。
