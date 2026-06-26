# ライセンス発行バックエンド セットアップ手順

Firebase（`mcp-switchpoint-wp-dev` / `-prod`）＋ Stripe（商品 `mcp-switchPoint-wp`、$5/月・$48/年）で
Pro ライセンスの **Ed25519 署名トークン**を発行する。クライアント検証コアは実装済み
（`src/main/services/license/`、[ADR-0006](./adr/0006-license-token-and-device-policy.md)）。

> ⚠ `firebase login` / `deploy` / `secrets:set` / `ext:install` は対話・認証が要るため、
> 端末側（`!` 実行）で行う。プロジェクト ID は `firebase projects:list` で**実値を確認**して
> `.firebaserc` を必要なら修正すること（表示名の大文字は ID では小文字化されている場合がある）。

## 構成

```
クライアント(Electron)
  └─ Firebase Auth（Email/Password・Google）でサインイン
  └─ checkout_sessions ドキュメント作成 → 拡張が Stripe Checkout URL を返す → 決済
  └─ issueLicense({deviceId}) callable
        ├─ customers/{uid}/subscriptions の active/trialing を確認（拡張が同期）
        ├─ customers/{uid}/devices に登録（最大3台）
        └─ Ed25519 署名トークンを返す（秘密鍵=Secret Manager）
```

## 手順

### 1. ログインとプロジェクト確認
```bash
firebase login
firebase projects:list                 # dev/prod の実 project ID を確認
firebase use dev                        # = mcp-switchpoint-wp-dev（.firebaserc）
```

### 2. 署名鍵の生成（dev 用）
```bash
node scripts/gen-license-keypair.mjs
```
- 出力の **PUBLIC KEY** を `src/main/realDeps.ts` の `LICENSE_PUBLIC_KEY` に貼る。
- **PRIVATE KEY** は次の手順で Secret Manager へ。dev/prod で別々の鍵を使う。

### 3. 秘密鍵を Secret Manager へ
```bash
firebase functions:secrets:set LICENSE_PRIVATE_KEY
# プロンプトに PRIVATE KEY（-----BEGIN PRIVATE KEY----- ... END -----）を貼り付け
```

### 4. Stripe 拡張をインストール
> ⚠ `stripe/firestore-stripe-payments` は Stripe から **Invertase へ移管（旧版はディプリケート）**。
> **`invertase/firestore-stripe-payments`**（2026-06 時点 v0.3.12）を使う。中身・Firestore 構造・
> パラメータは同一。`ext:install` は対話のみのため**通常ターミナル**で実行（Claude の `!` 不可）。

```bash
firebase ext:install invertase/firestore-stripe-payments --project=mcp-switchpoint-wp-dev
firebase deploy --only extensions --project=mcp-switchpoint-wp-dev
```

> 新規プロジェクトでは初回デプロイが Artifact Registry 権限不足（403）で失敗することがある。
> その場合は既定 Compute SA に権限を付与してから再デプロイ:
> ```bash
> gcloud projects add-iam-policy-binding mcp-switchpoint-wp-dev \
>   --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
>   --role="roles/artifactregistry.reader"
> ```
設定の要点:
- **Products and pricing plans collection**: `products`
- **Customer details and subscriptions collection**: `customers`
- **Sync new users to Stripe customers and Cloud Firestore**: 有効（Sync）
- **Stripe API key**: サンドボックスの**制限付き**シークレットキー（Secret Manager 管理）
- **Stripe webhook secret**: いったん空でインストール → 出力された **Webhook URL** を
  Stripe ダッシュボード（テスト）の Webhook に登録し、署名シークレットを拡張へ再設定。
  必要イベント: `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
  `product.*`, `price.*`, `invoice.*`。

### 5. Stripe 商品メタデータ（任意・推奨）
商品 `mcp-switchPoint-wp` に `firebaseRole = pro` を設定しておくと、拡張がカスタムクレームを
付与でき将来の判定が楽。トークン発行自体はサブスク status を直接見るので必須ではない。
価格は $5/月・$48/年の2 price を有効化。

### 6. デプロイ
```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules --project=mcp-switchpoint-wp-dev
```

### 7. 動作確認（最小）
1. テストユーザーでサインイン（Auth コンソールで手動作成可）。
2. Stripe テストカード `4242 4242 4242 4242` で Checkout → サブスク active。
3. `issueLicense({deviceId:'test-device'})` を呼ぶ（エミュレータ or 本番）→ `{token, exp}` が返る。
4. token を `src/main/services/license` の `verify` に通すと `ok:true / expired:false`。

## 本番（prod）移行
- `firebase use prod` で `mcp-switchpoint-wp-prod` に切替え、**別の鍵ペア**で 2〜6 を再実行。
- Stripe を**本番モード**の API キー・Webhook に。アプリの公開鍵も prod 用に差し替える
  （dev/prod 同梱を切り替える仕組みは配布時に検討）。

## 関連
- トークン契約・台数ポリシー: [ADR-0006](./adr/0006-license-token-and-device-policy.md)
- enforcement は当面 OFF（Free でも全機能）: [ADR-0004](./adr/0004-entitlement-gate-deferred-enforcement.md)
- 秘密鍵をサーバーに置くのは config マネージャー方針の明示的例外: [ADR-0003](./adr/0003-config-manager-boundary.md)
