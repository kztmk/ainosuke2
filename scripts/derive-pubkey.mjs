/**
 * 標準入力の Ed25519 秘密鍵(PEM)から対応する公開鍵(SPKI/PEM)を導出して表示する。
 * 登録した秘密鍵が realDeps.ts の公開鍵と一致するか照合するのに使う。
 *
 *   pbpaste | node scripts/derive-pubkey.mjs
 */
import { createPrivateKey, createPublicKey } from "node:crypto";

let pem = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (pem += c));
process.stdin.on("end", () => {
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    console.error("✗ 標準入力に PRIVATE KEY がありません（クリップボードに秘密鍵をコピーして再実行）。");
    process.exit(1);
  }
  const pub = createPublicKey(createPrivateKey(pem)).export({ type: "spki", format: "pem" }).toString().trim();
  console.log(pub);
});
