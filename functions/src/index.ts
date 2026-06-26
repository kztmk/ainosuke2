/**
 * WP MCP Manager ライセンス発行バックエンド。
 *
 * 構成:
 *   - firestore-stripe-payments 拡張が customers/{uid}/subscriptions に課金状態を同期する。
 *   - 本 Function はそれを参照し、端末（最大3台）を登録のうえ Ed25519 署名トークンを発行する。
 *
 * callable:
 *   - issueLicense({ deviceId, deviceName? }) -> { token, exp }
 *   - listDevices() -> { maxDevices, devices[] }
 *   - revokeDevice({ deviceId }) -> { ok }
 */
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { signLicense, type LicenseClaims } from "./license";
import { MAX_DEVICES, ENFORCE_DEVICE_LIMIT, TOKEN_TTL_DAYS, ACTIVE_STATUSES, REGION } from "./config";

initializeApp();
const db = getFirestore();

/** Ed25519 秘密鍵（PKCS8 PEM）。`firebase functions:secrets:set LICENSE_PRIVATE_KEY` で投入。 */
const LICENSE_PRIVATE_KEY = defineSecret("LICENSE_PRIVATE_KEY");

function requireUid(req: CallableRequest): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in-required");
  return uid;
}

function requireDeviceId(data: unknown): string {
  const id = String((data as { deviceId?: unknown })?.deviceId ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "device-id-required");
  return id;
}

function toSeconds(value: unknown): number {
  if (value instanceof Timestamp) return value.seconds;
  if (typeof value === "number") return value > 1e12 ? Math.floor(value / 1000) : value;
  return 0;
}

function toIso(value: unknown): string | null {
  const sec = toSeconds(value);
  return sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

/** アクティブなサブスクの中で最も先の current_period_end（秒）を返す。無ければ 0。 */
async function farthestActivePeriodEnd(uid: string): Promise<number> {
  const snap = await db
    .collection(`customers/${uid}/subscriptions`)
    .where("status", "in", ACTIVE_STATUSES as unknown as string[])
    .get();
  if (snap.empty) return -1;
  let end = 0;
  for (const doc of snap.docs) {
    const sec = toSeconds(doc.get("current_period_end"));
    if (sec > end) end = sec;
  }
  return end;
}

export const issueLicense = onCall(
  { region: REGION, secrets: [LICENSE_PRIVATE_KEY] },
  async (req) => {
    const uid = requireUid(req);
    const deviceId = requireDeviceId(req.data);
    const deviceName = String((req.data as { deviceName?: unknown })?.deviceName ?? "").slice(0, 80);

    const periodEnd = await farthestActivePeriodEnd(uid);
    if (periodEnd < 0) throw new HttpsError("failed-precondition", "no-active-subscription");

    // 端末登録（3台上限）。トランザクションで読み取り→判定→書き込み。
    const deviceRef = db.doc(`customers/${uid}/devices/${deviceId}`);
    const devicesCol = db.collection(`customers/${uid}/devices`);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(deviceRef);
      if (existing.exists) {
        tx.update(deviceRef, {
          lastSeenAt: FieldValue.serverTimestamp(),
          ...(deviceName ? { name: deviceName } : {}),
        });
        return;
      }
      if (ENFORCE_DEVICE_LIMIT) {
        const all = await tx.get(devicesCol);
        if (all.size >= MAX_DEVICES) {
          throw new HttpsError("resource-exhausted", "device-limit-reached");
        }
      }
      tx.set(deviceRef, {
        name: deviceName || null,
        createdAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      });
    });

    // exp = min(now + TTL, サブスク期限)。期限が無い(=0)場合は TTL のみ。
    const now = Math.floor(Date.now() / 1000);
    const ttlExp = now + TOKEN_TTL_DAYS * 24 * 60 * 60;
    const exp = periodEnd > 0 ? Math.min(ttlExp, periodEnd) : ttlExp;

    const claims: LicenseClaims = { tier: "pro", userId: uid, deviceId, iat: now, exp };
    const token = signLicense(LICENSE_PRIVATE_KEY.value(), claims);
    return { token, exp };
  },
);

export const listDevices = onCall({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const snap = await db.collection(`customers/${uid}/devices`).get();
  return {
    maxDevices: MAX_DEVICES,
    devices: snap.docs.map((d) => ({
      deviceId: d.id,
      name: (d.get("name") as string | null) ?? null,
      createdAt: toIso(d.get("createdAt")),
      lastSeenAt: toIso(d.get("lastSeenAt")),
    })),
  };
});

export const revokeDevice = onCall({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const deviceId = requireDeviceId(req.data);
  await db.doc(`customers/${uid}/devices/${deviceId}`).delete();
  return { ok: true };
});
