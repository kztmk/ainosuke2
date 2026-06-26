/**
 * ライセンス署名用 Ed25519 鍵ペアを生成して標準出力に表示する。
 *
 *   node scripts/gen-license-keypair.mjs
 *
 * - PUBLIC KEY  -> src/main/realDeps.ts の LICENSE_PUBLIC_KEY に貼る（アプリ同梱・検証用）
 * - PRIVATE KEY -> `firebase functions:secrets:set LICENSE_PRIVATE_KEY` に貼る（サーバーのみ）
 *
 * 秘密鍵はファイルに保存せず・git にコミットしない。dev/prod で別々の鍵を使うこと。
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();

console.log("\n===== PUBLIC KEY (アプリへ同梱: src/main/realDeps.ts) =====\n");
console.log(pub);
console.log("\n===== PRIVATE KEY (サーバーのみ: functions:secrets:set LICENSE_PRIVATE_KEY) =====\n");
console.log(priv);
console.log("\n⚠ 秘密鍵はコミット・保存しない。dev と prod で別の鍵を生成すること。\n");
