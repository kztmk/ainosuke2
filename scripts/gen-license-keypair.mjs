/**
 * ライセンス署名用 Ed25519 鍵ペアを生成する。
 *
 * 表示モード（従来）:
 *   node scripts/gen-license-keypair.mjs
 *     PUBLIC/PRIVATE を標準出力に表示。
 *
 * ファイル出力モード（provision-license-key.sh から使用）:
 *   node scripts/gen-license-keypair.mjs --pub <path> --priv <path>
 *     公開鍵/秘密鍵を指定ファイルへ(0600)。秘密鍵は stdout に出さない。
 *
 * 秘密鍵はコミット・保存しない。dev/prod で別々の鍵を使うこと。
 */
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const pubOut = flag("--pub");
const privOut = flag("--priv");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();

if (pubOut || privOut) {
  if (pubOut) writeFileSync(pubOut, pub + "\n", { mode: 0o600 });
  if (privOut) writeFileSync(privOut, priv + "\n", { mode: 0o600 });
  // 秘密鍵はファイルにのみ出力（標準出力には出さない）。公開鍵だけ表示。
  if (pubOut) {
    console.log(pub);
  }
} else {
  console.log("\n===== PUBLIC KEY (アプリへ同梱: src/main/realDeps.ts) =====\n");
  console.log(pub);
  console.log("\n===== PRIVATE KEY (サーバーのみ: functions:secrets:set LICENSE_PRIVATE_KEY) =====\n");
  console.log(priv);
  console.log("\n⚠ 秘密鍵はコミット・保存しない。dev と prod で別の鍵を生成すること。\n");
}
