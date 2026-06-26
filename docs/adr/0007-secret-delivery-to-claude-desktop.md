# Claude Desktop への秘密受け渡し方式（ファイル平文 vs OS キーチェーン・ラッパー）

接続中、認証情報（Application Password）を Claude Desktop の MCP サーバーへ渡す方式として、**Phase 1 既定は `claude_desktop_config.json` の `env` への平文書き出し**を採る。OS キーチェーン＋ラッパースクリプト方式は、**不完全解であること・[ADR-0003](./0003-config-manager-boundary.md) の境界を押し広げること**を理由に既定にはせず、将来の **Pro 向けオプトイン硬化機能**の候補として保留する。

## 背景

本アプリのセキュリティ物語は「アプリ内では safeStorage で暗号化保管し、平文はレンダラに渡さない」で成立している。残る平文露出は1点 ── **接続トグル ON 時に `claude_desktop_config.json` の `env` へ書き出される瞬間のファイル平文**だけ（[ADR-0003](./0003-config-manager-boundary.md) の「使うときだけ書き出す」運用で時間的に最小化）。

これを OS キーチェーン参照に置き換える「ラッパースクリプト方式」が一般的な MCP 硬化パターンとして存在する（裏取り済みの実例）:

```json
{
  "mcpServers": {
    "site-name": {
      "command": "/bin/sh",
      "args": ["-c", "WP_API_PASSWORD=$(security find-generic-password -a site-name -s wp-pw -w) exec npx -y mcp-wordpress-remote ..."]
    }
  }
}
```

config から平文を消し、保存先をファイルから OS 保護領域へ移せる。

## 評価：消せるもの／消せないもの

- **消せる**: `claude_desktop_config.json` 内のディスク平文。バックアップ・クラウド同期・他アプリによるファイル読み取りのリスクは消える。
- **消せない**: 起動後、秘密は**子プロセスの環境変数に乗ったまま**になる。Claude 自身がシェル系ツール経由で `printenv` / `echo $WP_API_PASSWORD` を実行すれば読める経路は残る（"echo trick"）。

→ **「ディスク平文の除去」には効くが「実行中プロセスからの露出」は塞げない不完全解**。過大に「完全解決」と表示してはならない。

## ラッパー方式を既定にしない理由

1. **ADR-0003 境界の拡大**: 「config を書くだけ」から、サイトごとのシェル/PowerShell 起動ラッパーの**生成・配置・実行権限付与・スペース入りパス処理**まで責務が広がる。
2. **クロスプラットフォーム非対称**:
   - macOS: `security … -w` で平文取得可。
   - Windows: `cmdkey` は保存はできるが**標準 CLI で平文を取り出せない**。`Get-StoredCredential` は PSGallery の `CredentialManager` モジュール依存 → 取得ヘルパーの同梱が要る。
   - Linux: `secret-tool`（libsecret）。
3. **既存 safeStorage 資産を再利用不可**: safeStorage の暗号化データは外部 CLI から名前引きで取り出せる形式ではない。ラッパー方式は OS キーチェーンへ**別途**書き込む経路が必要で二重管理になる。
4. **アンインストール掃除**（[ADR-0005](./0005-plaintext-cleanup-on-uninstall.md)）に**キーチェーンエントリ削除**の追加が必要。

## 却下／保留した代替案

- **Claude Desktop 拡張（.mcpb/.dxt）の `user_config` + `"sensitive": true`**: Claude Desktop がネイティブに OS キーチェーンへ暗号化保管するが、**MCP サーバーを拡張としてパッケージ化**した場合のみ有効。`npx mcp-wordpress-remote` を生の `mcpServers` で起動する本方式には効かない。生 config への OS キーチェーン対応は機能要望段階（anthropics/claude-code #15961）。範囲外。
- **`${VAR}` 環境変数展開**: Claude **Code** の `.mcp.json` ではサポートされるが、Claude **Desktop** の `claude_desktop_config.json` での確証は薄い。仮に使えても `${VAR}` の置き場を保護領域にするには結局ラッパーが要り、単独解にならない。
- **`.env` ファイル（`chmod 600`）＋ラッパー**: config.json から秘密を切り離せるが、**保存時は依然平文**（暗号化なし）であり「平文→平文の横移動」にとどまる。echo trick もバックアップ/同期リスクも残る。一方でコスト（ラッパー生成＝[ADR-0003](./0003-config-manager-boundary.md) 拡大、クロスプラットフォーム非対称＝`chmod 600` は Windows で無効・`icacls` 等が要、掃除対象が `.env` の分だけ増加）はキーチェーン方式とほぼ同等。**同コストでキーチェーン方式に保護面で劣後するため独立策としては却下**。ただし **OS キーチェーン CLI が使えない環境（例: keyring 無しのヘッドレス Linux）でのフォールバック層**としてのみ価値があり、上記オプトイン機能の二段目として残す。

## Consequences

- Phase 1 既定は現状維持（`env` への平文書き出し＋接続トグルによる時間的最小化）。これは妥当な姿勢として受容する。
- 将来、ラッパー方式を **Pro 向けオプトイン（既定 OFF）** として実装する場合の最小設計:
  - 設定に「OS キーチェーンで認証情報を保護（実験的）」トグル。
  - 接続時、平文を `env` へ書く代わりに OS キーチェーンへ書き、config を上記ラッパー形へ。retrieval は mac=`security` / win=`cmdkey`＋取得ヘルパー / linux=`secret-tool`。
  - 切断・アンインストール時にキーチェーンエントリも掃除（[ADR-0005](./0005-plaintext-cleanup-on-uninstall.md) に追記）。
  - UI に「Claude 自身が env を読める可能性は残る」旨を明記し、過大表示を避ける。
- この機能の価値は限定的（ディスク平文除去のみ）であることを前提に、優先度は Phase 4 以降とする。

## Sources

- [Securing MCP Server Secrets with macOS Keychain（kahunam）](https://kahunam.com/articles/automations-ai/securing-mcp-server-secrets-with-macos-keychain/)
- [FEATURE: OS Keychain/Credential Manager Support for MCP · anthropics/claude-code #15961](https://github.com/anthropics/claude-code/issues/15961)
- [Why Every MCP Setup Guide Is Teaching You to Store API Keys Wrong（dev.to）](https://dev.to/the_seventeen/why-every-mcp-setup-guide-is-teaching-you-to-store-api-keys-wrong-4ghf)
- [Connect Claude Code to tools via MCP（`${VAR}` 展開）](https://code.claude.com/docs/en/mcp)
