#!/usr/bin/env sh
# ライセンス署名鍵を生成し、秘密鍵を Secret Manager に登録、公開鍵だけ表示する（一括）。
#
#   sh scripts/provision-license-key.sh dev      # または prod
#
# - 鍵ペアは必ず一致（同一実行で生成）
# - 秘密鍵はクリップボード・シェル履歴・git に残らない（一時ディレクトリ経由・終了時削除）
# - 表示された PUBLIC KEY を src/main/realDeps.ts に貼り、Claude に伝える
set -e

ALIAS="${1:-dev}"
case "$ALIAS" in
  dev)  PROJECT="mcp-switchpoint-wp-dev" ;;
  prod) PROJECT="mcp-switchpoint-wp-prod" ;;
  *) echo "usage: sh scripts/provision-license-key.sh [dev|prod]"; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Ed25519 鍵ペアを生成..."
node scripts/gen-license-keypair.mjs --pub "$TMP/pub.pem" --priv "$TMP/priv.pem" >/dev/null

echo "→ $PROJECT に LICENSE_PRIVATE_KEY を登録..."
firebase functions:secrets:set LICENSE_PRIVATE_KEY --data-file "$TMP/priv.pem" --project "$PROJECT"

echo ""
echo "===== PUBLIC KEY（src/main/realDeps.ts に貼付し、Claude に伝える / $PROJECT） ====="
cat "$TMP/pub.pem"
