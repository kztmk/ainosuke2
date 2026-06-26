# ライセンストークン仕様とアカウント型・複数台ポリシー

Pro ライセンスは**アカウント型・複数台管理**を採る（最大 3 台・[MAX_DEVICES]）。台数制限・個別失効・自動更新を満たすには無管理のトークン共有では不十分で、将来 Firebase Auth でアカウントに紐づける（モデル B）。ただしアプリ側の**検証コアは入手手段に依存しない**ため、`LicenseProvider` 抽象を挟み、当面は手動トークン投入、本命は `FirebaseAuthProvider` に差し替える。

## トークン形式（発行サーバーとアプリの契約）

```
token = base64url(JSON(claims)) + "." + base64url(ed25519_signature)
signature = Ed25519(privateKey, utf8(base64url(JSON(claims))))
claims = { tier: 'pro', userId, deviceId, iat, exp }   // iat/exp は unix 秒
```

- 署名は **Ed25519**。アプリは**公開鍵のみ**を同梱して検証する。**秘密鍵は発行サーバー（Firebase Function）にのみ置く**。これは「config マネージャーに徹する／サーバーを持たない」([ADR-0003](./0003-config-manager-boundary.md)) の明示的な例外 ── ライセンス署名だけはサーバーが不可避（秘密鍵を同梱すると偽造可能になるため）。
- アプリは JWT ライブラリを使わず Node 標準 crypto で検証（依存削減・`src/main/services/license`）。

## オフライン耐性（§12.2）

- トークンをローカルにキャッシュ。`exp` 未満なら Pro（`valid`）。
- `exp` を過ぎても **14 日**（[LICENSE_OFFLINE_GRACE_DAYS]）以内は Pro 継続（`grace`）。再検証できないオフライン環境を許容する。
- 猶予超過で Free（`expired`）。署名不正・改ざんは Free（`invalid`）。

## 台数管理（最大 3 台）

- 各端末は安定 `deviceId`（初回生成しローカル保存）を持つ。
- **上限の強制は発行サーバー側**で行う（新しい `deviceId` へのトークン発行時に Firestore の登録台数を確認し、3 台超なら拒否）。アプリは `deviceId` を表示し、登録/失効は将来 `FirebaseAuthProvider` 経由で扱う。

## enforcement の扱い

- 本実装ではライセンス→`tier` 反映までを作るが、**enforcement フラグは OFF のまま**（[ADR-0004](./0004-entitlement-gate-deferred-enforcement.md)）。Free でも全機能アンロックを維持し、上限・機能ロックの実強制は「課金本稼働＋初期ユーザー grandfather」確定時に ON にする。

## 残（別段）

- Firebase Function による発行（Stripe Webhook→Firestore→署名トークン）、`FirebaseAuthProvider`（サインイン＋callable 取得・自動更新）、本番公開鍵への差し替え、`CHECKOUT_URL` の実値設定。
