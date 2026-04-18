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
- `wrangler.jsonc.example`: 参考設定（全変数名コメント付き）

---

## セットアップ手順（詳細版）

> ここからは **Cloudflare ダッシュボードを 1 クリックずつ** 進める手順です。  
> 詳細な手順書は [SETUP_GUIDE.md](./SETUP_GUIDE.md) を参照してください。

### 事前に用意するもの
| 項目 | 取得場所 |
|------|---------|
| Cloudflare アカウント | https://dash.cloudflare.com |
| Resend アカウント + 送信ドメイン verified | https://resend.com |
| Have I Been Pwned API キー | https://haveibeenpwned.com/API/Key |
| Cloudflare Turnstile サイト/シークレットキー | Cloudflare ダッシュボード → Turnstile |

---

### STEP 1: D1 データベースを作成する

1. https://dash.cloudflare.com を開く
2. 左メニュー → **Workers & Pages** → **D1 SQL Database**
3. 右上 **Create database** をクリック
4. Database name に `hibp_checker` と入力 → **Create** をクリック
5. 作成後に表示される **Database ID** をコピーしておく

#### D1 テーブルを初期化する（Wrangler CLI）
```bash
# wrangler.jsonc に database_id を記入したあと実行
npx wrangler d1 execute hibp_checker --remote --file=schema.sql
```

または Cloudflare ダッシュボードの D1 画面 → **Console** タブに `schema.sql` の内容を貼り付けて実行してもよい。

---

### STEP 2: KV Namespace を作成する

1. 左メニュー → **Workers & Pages** → **KV**
2. 右上 **Create a namespace** をクリック
3. Namespace Name に `TOKENS` と入力 → **Add** をクリック
4. 作成後に表示される **Namespace ID** をコピーしておく

---

### STEP 3: Cloudflare Pages プロジェクトを作成する

1. 左メニュー → **Workers & Pages** → **Pages**
2. **Create a project** → **Connect to Git**
3. GitHub のリポジトリ（このリポジトリ）を選択 → **Begin setup**
4. **Build settings**:
   - Framework preset: `None`
   - Build command: *(空欄)*
   - Build output directory: `/`
5. **Save and Deploy** をクリック（最初のデプロイが走る）

---

### STEP 4: Bindings を接続する

デプロイ後、Pages プロジェクトの設定画面で行う。

1. **Workers & Pages** → 作成したプロジェクト名をクリック
2. **Settings** タブをクリック
3. **Bindings** セクション → **Add** をクリック

#### KV Namespace の接続
| 項目 | 値 |
|------|---|
| Variable name | `TOKENS` |
| KV namespace | 手順 2 で作った namespace |

#### D1 Database の接続
| 項目 | 値 |
|------|---|
| Variable name | `DB` |
| D1 database | 手順 1 で作った database |

> **重要**: Variable name はコードと **完全一致** させること。`TOKENS` / `DB` 以外にすると動かない。

---

### STEP 5: 環境変数 (Variables and Secrets) を登録する

同じ **Settings** 画面の **Variables and Secrets** セクション。

| 変数名 | 値の例 | Encrypt |
|--------|--------|---------|
| `APP_BASE_URL` | `https://your-project.pages.dev` | OFF |
| `FROM_EMAIL` | `HIBP Checker <noreply@mail.example.com>` | OFF |
| `TURNSTILE_SITE_KEY` | Turnstile の Site Key | OFF |
| `APP_USER_AGENT` | `hibp-checker-pages/1.0` | OFF |
| `CONFIRM_TOKEN_TTL_SECONDS` | `900` | OFF |
| `EMAIL_COOLDOWN_SECONDS` | `300` | OFF |
| `MAX_REQUESTS_PER_10_MIN_IP` | `5` | OFF |
| `MAX_REQUESTS_PER_15_MIN_EMAIL` | `3` | OFF |
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` | **ON (Encrypt)** |
| `HIBP_API_KEY` | HIBPのAPIキー | **ON (Encrypt)** |
| `TURNSTILE_SECRET_KEY` | Turnstile のシークレットキー | **ON (Encrypt)** |

> **`FROM_EMAIL` の形式**: `表示名 <address@verified-domain.example>` の形式にすること。  
> Resend で verified になっていないドメインを使うと **422 エラー** になる。

---

### STEP 6: 再デプロイする

バインディング・環境変数を保存しただけでは反映されない。**必ず再デプロイ**する。

1. **Deployments** タブをクリック
2. 最新のデプロイ行の右端 **…** → **Retry deployment** をクリック

または、GitHub に空コミットを push してもよい。

---

### STEP 7: 動作確認

1. `https://your-project.pages.dev` を開く
2. メールアドレスを入力して **確認メールを送信** を押す
3. 受信箱に確認メールが届くことを確認
4. メール内のリンクをクリック
5. HIBP チェック完了後、結果メールが届くことを確認
6. 迷惑メールフォルダも確認する

---

## よくある詰まりポイント

| 症状 | 原因と対処 |
|------|-----------|
| 500 エラー (確認メール送信時) | `RESEND_API_KEY` が未設定、または Resend でドメインが verified でない |
| 422 エラー (Resend 側) | `FROM_EMAIL` が Resend verified ドメイン配下でない |
| 401 エラー (Resend 側) | `RESEND_API_KEY` が間違っている |
| CAPTCHA エラー | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` が一致していない |
| KV / D1 エラー | Bindings の Variable name が `TOKENS` / `DB` になっていない |
| 設定を変えたのに反映されない | 設定保存後に**再デプロイ**していない |

---

## Cloudflare Pages のバインディング（コード内変数名対応表）

### Variables and Secrets
| コード内 `context.env.*` | 説明 |
|--------------------------|------|
| `APP_BASE_URL` | アプリの公開 URL（確認メール内リンク生成に使用） |
| `APP_USER_AGENT` | 外部 API 呼び出し時の User-Agent |
| `HIBP_API_KEY` | Have I Been Pwned API v3 キー |
| `RESEND_API_KEY` | Resend API キー |
| `FROM_EMAIL` | Resend 送信元アドレス（verified ドメイン必須） |
| `TURNSTILE_SITE_KEY` | Turnstile サイトキー（フロント埋め込み用） |
| `TURNSTILE_SECRET_KEY` | Turnstile シークレットキー（サーバー検証用） |
| `CONFIRM_TOKEN_TTL_SECONDS` | 確認トークンの有効期限（秒）デフォルト: `900` |
| `EMAIL_COOLDOWN_SECONDS` | 確認メール送信後クールダウン（秒）デフォルト: `300` |
| `MAX_REQUESTS_PER_10_MIN_IP` | IP ごとの 10 分リクエスト上限 デフォルト: `5` |
| `MAX_REQUESTS_PER_15_MIN_EMAIL` | メールごとの 15 分リクエスト上限 デフォルト: `3` |

### Bindings
| Binding Variable name | 種別 | 説明 |
|-----------------------|------|------|
| `TOKENS` | KV Namespace | 確認トークン・クールダウンキーの保存 |
| `DB` | D1 Database | 監査ログ・トークンクレーム状態の保存 |

---

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
