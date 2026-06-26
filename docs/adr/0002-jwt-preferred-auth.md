---
status: superseded by ADR-0003
---

# Phase 1 の認証方式（JWT 推奨案 → 取り下げ）

当初、mcp-wordpress-remote が JWT（有効期限 1〜24h の短命トークン）に対応することを根拠に、Phase 1 の推奨認証方式を JWT に切り替える案を採用した。狙いは、接続中に `env` へ乗るシークレットを「恒久アプリケーションパスワード」から「短命トークン」に格下げし、漏洩時の被害寿命を縮めることだった。

しかし追加の裏取りで前提が崩れた:

- 公式 mcp-adapter（仕様が必須とするプラグイン）は **JWT 発行機能を文書化していない**。JWT 発行はもともと非推奨化された旧 `Automattic/wordpress-mcp` プラグインの機能だった。
- 「アプリパス → 短命 JWT」の交換エンドポイントは**第三者プラグイン**（JWT Authentication for WP REST API）に依存し、mcp-adapter 内蔵ではない。
- 理想形（アプリパスを safeStorage 保持 → 接続時に短命 JWT をミント → config には短命トークンのみ）は、公式 mcp-adapter 単体では実現できない。

よって **JWT を Phase 1 の推奨にする案は取り下げる**。最終的な認証方針は [ADR-0003](./0003-config-manager-boundary.md) に定める。

なお元仕様 v1.1 の「平文露出は構造上不可避」という断定は依然不正確であり、「公式 mcp-adapter の標準構成では Application Password が現実的な唯一手段であり平文が乗る。JWT/OAuth は追加プラグイン導入で回避可能だが、本アプリの想定構成では前提にしない」と訂正する。
