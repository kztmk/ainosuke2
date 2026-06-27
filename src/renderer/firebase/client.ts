/**
 * renderer 用 Firebase クライアント。Auth（サインイン）・Firestore（サブスク状態/Checkout）・
 * Functions（issueLicense 等の callable）をまとめる。
 *
 * 役割分担:
 * - 認証・課金状態の取得・トークン発行要求は renderer（Firebase Web SDK が自然に動く）。
 * - 受け取った署名トークンは window.api.license.activate(token) で main に渡し、
 *   main の LicenseService が**独立して Ed25519 検証**してから保存する（信頼境界を維持）。
 */
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { addDoc, collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { CHECKOUT_RETURN_URL, FUNCTIONS_REGION, firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, FUNCTIONS_REGION);

export type { User };

export function onAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export function signInEmail(email: string, password: string): Promise<unknown> {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signUpEmail(email: string, password: string): Promise<unknown> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

/** Firebase Auth のエラーコードを返す（UI のローカライズ用）。 */
export function authErrorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) return String((e as { code: unknown }).code);
  return 'unknown';
}

// ---- Functions (callable) -------------------------------------------------

export interface IssuedLicense {
  token: string;
  exp: number;
}

export async function issueLicense(deviceId: string, deviceName?: string): Promise<IssuedLicense> {
  const fn = httpsCallable<{ deviceId: string; deviceName?: string }, IssuedLicense>(functions, 'issueLicense');
  const res = await fn({ deviceId, deviceName });
  return res.data;
}

export interface DeviceInfo {
  deviceId: string;
  name: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
}

export async function listDevices(): Promise<{ maxDevices: number; devices: DeviceInfo[] }> {
  const fn = httpsCallable<Record<string, never>, { maxDevices: number; devices: DeviceInfo[] }>(
    functions,
    'listDevices',
  );
  return (await fn({})).data;
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const fn = httpsCallable<{ deviceId: string }, { ok: boolean }>(functions, 'revokeDevice');
  await fn({ deviceId });
}

// ---- Firestore (subscriptions / checkout) ---------------------------------

/** アクティブ（active/trialing）なサブスクの有無を監視する（Stripe 拡張が同期）。 */
export function watchActiveSubscription(uid: string, cb: (active: boolean) => void): () => void {
  const q = query(
    collection(db, 'customers', uid, 'subscriptions'),
    where('status', 'in', ['active', 'trialing']),
  );
  return onSnapshot(
    q,
    (snap) => cb(!snap.empty),
    () => cb(false),
  );
}

/**
 * Stripe Checkout セッションを作成し、決済 URL を得る（Stripe 拡張の createCheckoutSession）。
 * customers/{uid}/checkout_sessions にドキュメントを作ると拡張が url を書き戻す。
 */
export function startCheckout(uid: string, priceId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void addDoc(collection(db, 'customers', uid, 'checkout_sessions'), {
      price: priceId,
      success_url: CHECKOUT_RETURN_URL,
      cancel_url: CHECKOUT_RETURN_URL,
    })
      .then((ref) => {
        const unsub = onSnapshot(
          ref,
          (snap) => {
            const data = snap.data() as { url?: string; error?: { message?: string } } | undefined;
            if (!data) return;
            if (data.error) {
              unsub();
              reject(new Error(data.error.message ?? 'checkout_error'));
            } else if (data.url) {
              unsub();
              resolve(data.url);
            }
          },
          (e) => {
            unsub();
            reject(e);
          },
        );
      })
      .catch(reject);
  });
}
