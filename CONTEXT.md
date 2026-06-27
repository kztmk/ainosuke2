# WP MCP Manager

複数の投稿先（セルフホスト型 WordPress、note.com 等）を Claude Desktop から自然言語で操作するための、ローカルインストール型デスクトップアプリ。MCP（Model Context Protocol）の設定・管理を GUI で提供する。

## Language

### 投稿先とプラットフォーム

**投稿先**:
Claude から記事を公開・管理できる先。本アプリが登録・管理する最上位の対象。プラットフォーム非依存の上位概念で、具体的には WordPress の「サイト」や note の「note アカウント」が下位の種別にあたる。
_避ける_: 接続先（「接続中」と紛らわしい）、アカウント（ライセンスの Firebase アカウントと多重定義になる）

**プラットフォーム**:
投稿先の種別。`wordpress` / `note` など。プラットフォームごとに認証方式・接続の仕組み・利用する MCP サーバーが異なる。

### サイトと状態

**サイト**:
**WordPress** プラットフォームの投稿先（投稿先の下位種別）。URL と認証情報を持つ。note 投稿先は「サイト」と呼ばない。
_避ける_: 接続先、サーバー

**保存済み**:
サイト情報がローカル（electron-store + safeStorage）に永続化されているが、`claude_desktop_config.json` にはまだ書き込まれていない状態。`enabled: false`。サイトの既定の静止状態。「登録」と「保存」は同一の行為を指す（第3の状態ではない）。
_避ける_: 無効、オフ、登録済み（状態名としては使わない）

**接続中**:
投稿先が `claude_desktop_config.json` に書き込まれている状態。`enabled: true`、`connectedAt` あり。プラットフォームで中身が異なる ── **WordPress** は `env` に認証シークレットが平文で乗る（ディスク上に秘密が存在する）。**note** は bridge エントリとローカルアクセストークンのみで、note セッションはアプリ内に留まり config には乗らない。config に書いただけでは Claude Desktop は読み込まないため、次の2つのサブ状態を持つ。
_避ける_: 有効、オン、接続済み

**接続中（再起動待ち）**:
config に書き込んだが Claude Desktop が未再起動で、まだ実際には使えないサブ状態。UI で「要再起動」を明示する。

**接続中（反映済み）**:
Claude Desktop の再起動後、実際に Claude から使えるサブ状態。本アプリは再起動を確実に検知できないため、この判定はユーザーの再起動操作を目印にしたベストエフォートとする。

### ログイン（note 固有・接続とは独立した軸）

note 投稿先は「接続（config 軸）」とは別に「アプリが有効な note セッションを保持しているか」という軸を持つ。接続中でもログインしていなければ実際には使えない。WordPress には無い概念。

**ログイン中**:
アプリが有効な note セッション（BrowserWindow ログインで取得）を保持している状態。note 投稿先が実際に使えるのは「接続中 ＋ ログイン中 ＋ Claude 再起動済み ＋ アプリ常駐」が揃ったとき。

**要再ログイン**:
note セッションが失効/未取得の状態。接続中でも Claude から叩くと失敗するため、UI で「要再ログイン」を明示する（WordPress の「要再起動」と並ぶ注意表示）。

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
