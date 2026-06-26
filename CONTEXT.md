# WP MCP Manager

複数のセルフホスト型 WordPress サイトを Claude Desktop から自然言語で操作するための、ローカルインストール型デスクトップアプリ。MCP（Model Context Protocol）の設定・管理を GUI で提供する。

## Language

### サイトと状態

**サイト**:
登録された WordPress 投稿先。URL と認証情報を持つ。
_避ける_: 接続先、サーバー

**保存済み**:
サイト情報がローカル（electron-store + safeStorage）に永続化されているが、`claude_desktop_config.json` にはまだ書き込まれていない状態。`enabled: false`。サイトの既定の静止状態。「登録」と「保存」は同一の行為を指す（第3の状態ではない）。
_避ける_: 無効、オフ、登録済み（状態名としては使わない）

**接続中**:
サイトが `claude_desktop_config.json` に書き込まれている状態。`enabled: true`、`connectedAt` あり。認証シークレットがディスク上に存在する唯一の状態。config に書いただけでは Claude Desktop は読み込まないため、次の2つのサブ状態を持つ。
_避ける_: 有効、オン、接続済み

**接続中（再起動待ち）**:
config に書き込んだが Claude Desktop が未再起動で、まだ実際には使えないサブ状態。UI で「要再起動」を明示する。

**接続中（反映済み）**:
Claude Desktop の再起動後、実際に Claude から使えるサブ状態。本アプリは再起動を確実に検知できないため、この判定はユーザーの再起動操作を目印にしたベストエフォートとする。

### 操作

**同期**:
選択中サイトの WordPress から最新のサマリー（投稿数・下書き数・MCP アダプターバージョン）と接続ステータスを再取得する手動・読み取り専用の操作。WordPress → アプリ方向であり、`claude_desktop_config.json` への書き込み（接続）とは無関係。Free 機能（自動のバックグラウンド監視のみ Pro）。
_避ける_: リフレッシュ、更新、再読込

### 認証方式

mcp-wordpress-remote が仲介に用いる認証方式。本アプリは config を管理するだけで認証サーバーは自作しない（[ADR-0003](./docs/adr/0003-config-manager-boundary.md)）。Phase 1 の既定は **Application Password**、JWT は上級オプション、OAuth 2.1 は Phase 3。

**Application Password**:
WordPress 管理画面（ユーザー > プロフィール）で発行する恒久パスワード。公式 mcp-adapter の標準構成で確実に動く唯一の方式で、Phase 1 の既定。接続中は `env.WP_API_USERNAME` + `env.WP_API_PASSWORD` に平文で乗る。
_避ける_: アプリパス、APP パスワード

**JWT**:
有効期限 1〜24h の短命トークン。接続中は `env.JWT_TOKEN` に乗る。公式 mcp-adapter には発行機能がなく、旧/第三者プラグインに依存するため、Phase 1 では既定にせず上級オプションとして扱う。
_避ける_: トークン認証、ベアラ
