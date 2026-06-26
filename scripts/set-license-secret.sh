#!/usr/bin/env sh
# クリップボードの Ed25519 PRIVATE KEY を Secret Manager (LICENSE_PRIVATE_KEY) に登録する。
#
# 使い方:
#   1) gen-license-keypair.mjs の出力から PRIVATE KEY ブロック
#      (-----BEGIN PRIVATE KEY----- 〜 -----END PRIVATE KEY-----) をコピー
#   2) sh scripts/set-license-secret.sh dev      # または prod
#
# 鍵はコマンド引数にもシェル履歴にも残らない（mktemp 一時ファイル経由・終了時削除）。
set -e

ALIAS="${1:-dev}"
case "$ALIAS" in
  dev)  PROJECT="mcp-switchpoint-wp-dev" ;;
  prod) PROJECT="mcp-switchpoint-wp-prod" ;;
  *) echo "usage: sh scripts/set-license-secret.sh [dev|prod]"; exit 1 ;;
esac

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
pbpaste > "$TMP"

if ! grep -q "BEGIN PRIVATE KEY" "$TMP"; then
  echo "✗ クリップボードに PRIVATE KEY が見つかりません。"
  echo "  -----BEGIN PRIVATE KEY----- から -----END PRIVATE KEY----- までをコピーしてから再実行してください。"
  exit 1
fi

echo "→ $PROJECT に LICENSE_PRIVATE_KEY を登録します..."
firebase functions:secrets:set LICENSE_PRIVATE_KEY --data-file "$TMP" --project "$PROJECT"
echo "✓ 完了。"
