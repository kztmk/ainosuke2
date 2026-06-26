/**
 * ライセンストークン署名（発行サーバー側）。クライアント検証コア
 * （src/main/services/license/license.ts）と**同一の契約**を実装する（ADR-0006）。
 *
 *   token     = base64url(JSON(claims)) + "." + base64url(ed25519_signature)
 *   signature = Ed25519(privateKey, utf8(base64url(JSON(claims))))
 *   claims    = { tier:'pro', userId, deviceId, iat, exp }   // iat/exp は unix 秒
 *
 * 秘密鍵は Secret Manager（LICENSE_PRIVATE_KEY）にのみ置く。公開鍵だけアプリへ同梱。
 */
import { createPrivateKey, sign } from "node:crypto";

export interface LicenseClaims {
  tier: "pro";
  userId: string;
  deviceId: string;
  iat: number;
  exp: number;
}

export function signLicense(privateKeyPem: string, claims: LicenseClaims): string {
  const key = createPrivateKey(privateKeyPem);
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(payload, "utf8"), key);
  return `${payload}.${signature.toString("base64url")}`;
}
