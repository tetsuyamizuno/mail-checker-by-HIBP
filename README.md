# Cloudflare Pages Functions 版: HIBP + Resend + Turnstile + KV + D1

このサンプルは、次の 6 点をすべて含む Cloudflare Pages Functions 実装例です。

1. 確認メールフロー
2. レート制限
3. CAPTCHA (Cloudflare Turnstile)
4. トークン保存 (Workers KV)
5. 再送防止 (Resend Idempotency-Key + D1 token state)
6. 監査ログ (D1)

## ファイル構成
- `index.html`: 入力フォーム
- `confirm.html`: 確認ページ
- `assets/app.js`: フォーム送信 + Turnstile
- `assets/confirm.js`: 確認トークン実行
- `functions/api/config.js`: 公開設定取得
- `functions/api/request.js`: 確認メール送信
- `functions/api/confirm.js`: トークン検証 + HIBP + 結果メール送信
- `functions/_lib/*.js`: 共通処理
- `schema.sql`: D1 初期テーブル
- `wrangler.jsonc.example`: 参考設定

## 事前準備
- Cloudflare Pages プロジェクト
- Cloudflare KV namespace 1個 (`TOKENS`)
- Cloudflare D1 database 1個 (`DB`)
- Turnstile site key / secret key
- HIBP API v3 key
- Resend API key
- Resend で認証済みの `FROM_EMAIL`

## D1 初期化
Cloudflare ダッシュボードまたは Wrangler で D1 を作成し、`schema.sql` を適用してください。

## Cloudflare Pages のバインディング
### Variables and Secrets
- `APP_BASE_URL`
- `APP_USER_AGENT`
- `HIBP_API_KEY`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `CONFIRM_TOKEN_TTL_SECONDS` (例: `900`)
- `EMAIL_COOLDOWN_SECONDS` (例: `300`)
- `MAX_REQUESTS_PER_10_MIN_IP` (例: `5`)
- `MAX_REQUESTS_PER_15_MIN_EMAIL` (例: `3`)

### Bindings
- KV namespace binding: `TOKENS`
- D1 binding: `DB`

設定後は Pages を再デプロイしてください。

## デプロイ手順
1. このフォルダを GitHub に push
2. Cloudflare Pages で `Connect to Git`
3. Build command は空欄でも可
4. Build output directory は `/`
5. 上記の Variables / Secrets / Bindings を設定
6. 再デプロイ

## フロー
### /api/request
- メール形式チェック
- Turnstile サーバー側検証
- D1 監査ログから最近の送信回数を数えてレート制限
- KV に確認トークンを TTL 付きで保存
- Resend で確認メール送信 (Idempotency-Key 付き)

### /api/confirm
- トークンを KV から取得
- D1 `token_claims` で処理状態を管理
- HIBP API で漏えい照会
- Resend で結果メール送信 (Idempotency-Key 付き)
- D1 監査ログに記録
- 成功時は KV のトークンを削除

## 注意
- これは本番向けの土台サンプルです。
- より厳密な分散レート制限や長期監査保管が必要なら、要件に応じて設計を追加してください。
- 個人情報は必要最小限だけログに残す設計にしてください。
