# セットアップガイド — Cloudflare + Resend 1クリックずつ手順

このガイドは、**Cloudflare ダッシュボードと Resend ダッシュボードで何を、どの順番でクリックするか**だけに絞った手順書です。  
コードの変更は不要です。画面を開きながら上から順に進めてください。

---

## 全体の流れ

```
[Resend] ドメイン追加 → DNS 設定 → verified 確認
    ↓
[Resend] API キー作成
    ↓
[Cloudflare] D1 database 作成
    ↓
[Cloudflare] KV namespace 作成
    ↓
[Cloudflare] Turnstile サイト作成
    ↓
[Cloudflare] Pages プロジェクト作成 (GitHub 連携)
    ↓
[Cloudflare] Bindings 接続 (TOKENS / DB)
    ↓
[Cloudflare] Variables and Secrets 登録
    ↓
[Cloudflare] 再デプロイ
    ↓
[ブラウザ] 動作確認
```

---

## Part A: Resend の設定

### A-1. Resend にログインする

1. ブラウザで https://resend.com を開く
2. **Sign in** をクリック
3. アカウントでログインする

---

### A-2. 送信ドメインを追加する

> **ポイント**: ルートドメイン (`example.com`) ではなく、**サブドメイン** (`mail.example.com`) の使用を推奨します。

1. 左メニュー → **Domains** をクリック
2. 右上 **Add Domain** をクリック
3. **Domain** 欄に送信に使うドメインを入力（例: `mail.example.com`）
4. **Region** は `us-east-1` のまま（または任意）
5. **Add** をクリック
6. DNS レコードの一覧が表示される → **このページを開いたままにする**（次の手順で使う）

---

### A-3. Cloudflare DNS に SPF / DKIM を追加する

> Resend のドメイン画面に表示された各レコードを Cloudflare DNS に登録します。

1. **新しいタブ**で https://dash.cloudflare.com を開く
2. 対象ドメインの **DNS** → **Records** を開く
3. **Add record** をクリック

#### SPF レコードを追加する
| フィールド | 値 |
|-----------|-----|
| Type | `TXT` |
| Name | Resend に表示された値（通常 `@` または `mail`） |
| Content | Resend に表示された SPF 値（`v=spf1 include:...` の形式） |
| TTL | Auto |

4. **Save** をクリック

#### DKIM レコードを追加する（Resend に表示されている件数分繰り返す）
| フィールド | 値 |
|-----------|-----|
| Type | `TXT` または `CNAME`（Resend の表示に従う） |
| Name | Resend に表示された Name 値 |
| Content | Resend に表示された Value 値 |
| TTL | Auto |

5. **Save** をクリック

#### DMARC レコードを追加する（任意・推奨）
| フィールド | 値 |
|-----------|-----|
| Type | `TXT` |
| Name | `_dmarc.mail` （`mail.example.com` の場合） |
| Content | `v=DMARC1; p=none; rua=mailto:dmarc@example.com` |
| TTL | Auto |

6. **Save** をクリック

---

### A-4. Resend でドメインの verified を確認する

1. Resend の **Domains** 画面に戻る
2. 追加したドメインの **Status** が `Verified` になるまで待つ
   - DNS の反映には数分〜数時間かかることがある
   - **Verify** ボタンがあればクリックして手動確認できる

> `Verified` にならないと FROM_EMAIL を使った送信が失敗（422 エラー）になる。

---

### A-5. Resend の API キーを作成する

1. 左メニュー → **API Keys** をクリック
2. 右上 **Create API Key** をクリック
3. **Name** 欄に名前を入力（例: `hibp-checker-prod`）
4. **Permission** → **Sending access** を選択（Full access より安全）
5. **Domain** → 先ほど verified にしたドメインだけに制限する（任意・推奨）
6. **Add** をクリック
7. 表示された API キー（`re_xxxxxxxxxxxxxxxx`）を**コピーしてメモする**
   - **このページを閉じると二度と表示されない**
   - GitHub や公開コードには絶対に書かない

---

## Part B: Cloudflare D1 データベースを作成する

### B-1. D1 データベースを作成する

1. https://dash.cloudflare.com を開く
2. 左メニュー → **Workers & Pages** → **D1 SQL Database** をクリック
3. 右上 **Create database** をクリック
4. **Database name** に `hibp_checker` と入力
5. **Location** は `Auto` のまま
6. **Create** をクリック
7. 作成完了画面の **Database ID**（UUID 形式）をコピーしておく

---

### B-2. D1 テーブルを初期化する

#### 方法 1: ダッシュボードの Console を使う（CLI 不要）

1. 作成した D1 データベースをクリックして開く
2. **Console** タブをクリック
3. 以下の SQL を貼り付けて **Execute** をクリック

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  email_hash TEXT,
  email_masked TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL,
  message TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_ms ON audit_logs(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_email_hash_created ON audit_logs(email_hash, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_hash_created ON audit_logs(ip_hash, created_at_ms);

CREATE TABLE IF NOT EXISTS token_claims (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT,
  status TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  result_json TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_claims_status_updated ON token_claims(status, updated_at_ms);
```

#### 方法 2: Wrangler CLI を使う

```bash
npx wrangler d1 execute hibp_checker --remote --file=schema.sql
```

---

## Part C: Cloudflare KV Namespace を作成する

### C-1. KV Namespace を作成する

1. 左メニュー → **Workers & Pages** → **KV** をクリック
2. 右上 **Create a namespace** をクリック
3. **Namespace Name** に `TOKENS` と入力
4. **Add** をクリック
5. 作成された **Namespace ID** をコピーしておく

---

## Part D: Cloudflare Turnstile を設定する

### D-1. Turnstile サイトを作成する

1. 左メニュー → **Turnstile** をクリック
2. **Add site** をクリック
3. **Site name** に名前を入力（例: `hibp-checker`）
4. **Domain** に Pages の公開 URL を入力（例: `your-project.pages.dev`）
5. **Widget type** → `Managed` を選択
6. **Create** をクリック
7. 表示される **Site Key** と **Secret Key** を両方コピーしてメモする

---

## Part E: Cloudflare Pages プロジェクトを作成する

### E-1. Pages プロジェクトを作成する

1. 左メニュー → **Workers & Pages** → **Pages** をクリック
2. **Create a project** をクリック
3. **Connect to Git** をクリック
4. GitHub 連携が未設定の場合は **Connect GitHub** をクリックして認証する
5. リポジトリ一覧から **このリポジトリ**（`mail-checker-by-HIBP`）を選択
6. **Begin setup** をクリック

### E-2. ビルド設定を入力する

| 項目 | 値 |
|------|---|
| Project name | 任意（URLになる。例: `hibp-checker`） |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | *(空欄)* |
| Build output directory | `/` |

7. **Save and Deploy** をクリック
8. デプロイが完了するまで待つ（1〜2 分）
9. 公開 URL（`https://your-project.pages.dev`）が表示されることを確認

---

## Part F: Bindings と環境変数を設定する

### F-1. プロジェクトの設定画面を開く

1. **Workers & Pages** → 作成したプロジェクト名（例: `hibp-checker`）をクリック
2. 上部タブの **Settings** をクリック

---

### F-2. KV Namespace を接続する（Binding: TOKENS）

1. **Bindings** セクションを見つける
2. **Add** をクリック
3. **KV namespace** を選択
4. 以下の通り入力する:

| 項目 | 値 |
|------|---|
| Variable name | `TOKENS` ← **この名前でないと動かない** |
| KV namespace | Part C で作った namespace を選択 |

5. **Save** をクリック

---

### F-3. D1 Database を接続する（Binding: DB）

1. **Bindings** セクションの **Add** をクリック
2. **D1 database** を選択
3. 以下の通り入力する:

| 項目 | 値 |
|------|---|
| Variable name | `DB` ← **この名前でないと動かない** |
| D1 database | Part B で作った database を選択 |

4. **Save** をクリック

---

### F-4. 環境変数を登録する（Variables and Secrets）

1. **Variables and Secrets** セクションを見つける
2. **Add variable** をクリック

以下の変数を **1 つずつ** 追加する:

#### 公開値（Encrypt OFF のまま）

| Variable name | Value |
|---------------|-------|
| `APP_BASE_URL` | `https://your-project.pages.dev`（実際の URL に変更） |
| `FROM_EMAIL` | `HIBP Checker <noreply@mail.example.com>`（verified ドメインに変更） |
| `TURNSTILE_SITE_KEY` | Part D でコピーした Site Key |
| `APP_USER_AGENT` | `hibp-checker-pages/1.0` |
| `CONFIRM_TOKEN_TTL_SECONDS` | `900` |
| `EMAIL_COOLDOWN_SECONDS` | `300` |
| `MAX_REQUESTS_PER_10_MIN_IP` | `5` |
| `MAX_REQUESTS_PER_15_MIN_EMAIL` | `3` |

#### 秘密値（Encrypt を **ON** にしてから保存）

> 「Encrypt」トグルをONにすると、保存後は値が見えなくなり安全に管理される。

| Variable name | Value | Encrypt |
|---------------|-------|---------|
| `RESEND_API_KEY` | Part A-5 でコピーした API キー | **ON** |
| `HIBP_API_KEY` | Have I Been Pwned の API キー | **ON** |
| `TURNSTILE_SECRET_KEY` | Part D でコピーした Secret Key | **ON** |

3. すべて **Save** をクリック

> **FROM_EMAIL の形式について**  
> `表示名 <address@verified-domain.example>` の形式で入力すること。  
> 例: `HIBP Checker <noreply@mail.example.com>`  
> verified になっていないドメインを使うと Resend が 422 エラーを返す。

---

## Part G: 再デプロイする

バインディング・環境変数の変更は**再デプロイ後**に反映される。

### G-1. 再デプロイを実行する

1. プロジェクトの **Deployments** タブをクリック
2. 最新のデプロイ行を見つける
3. 右端の **…（三点リーダー）** をクリック
4. **Retry deployment** をクリック
5. デプロイ完了を待つ（ステータスが **Success** になる）

---

## Part H: 動作テストをする

### H-1. フォーム送信テスト

1. ブラウザで `https://your-project.pages.dev` を開く
2. メールアドレスを入力する（自分のアドレスを使う）
3. Turnstile CAPTCHA が表示されることを確認してチェックを入れる
4. **確認メールを送信** をクリック
5. 「確認メールを送信しました」のメッセージが表示されることを確認

### H-2. 確認メール受信・リンク確認

1. メールクライアントで受信箱を開く
2. 確認メールが届いていることを確認
3. 迷惑メールフォルダも確認する
4. メール内の **確認してチェックを実行** ボタンをクリック

### H-3. 結果メール確認

1. `confirm.html` ページが開き「結果メールを送信しました」が表示されることを確認
2. 結果メールが届いていることを確認
3. 漏えい件数が正しく表示されていることを確認

---

## Part I: ログを確認する

### I-1. Resend 送信ログを確認する

1. https://resend.com を開く
2. 左メニュー → **Emails** をクリック
3. 送信したメールの一覧と Status を確認する
   - `delivered`: 正常
   - `bounced` / `complained`: アドレス・ドメイン設定の問題

### I-2. Cloudflare Pages Functions ログを確認する

1. Cloudflare ダッシュボード → Pages プロジェクトを開く
2. **Deployments** タブ → 最新デプロイをクリック
3. **Functions** タブをクリック
4. リアルタイムログまたは直近ログを確認する

---

## トラブルシューティング早見表

| エラー | 確認箇所 |
|--------|---------|
| 画面が真っ白 / 500 エラー | Bindings が保存されているか、再デプロイしたか |
| CAPTCHA が表示されない | `TURNSTILE_SITE_KEY` が正しいか |
| 確認メールが届かない | `RESEND_API_KEY` が正しいか、`FROM_EMAIL` が verified ドメインか |
| 迷惑メールに入る | SPF / DKIM が Cloudflare DNS に正しく登録されているか |
| Resend 422 エラー | `FROM_EMAIL` のドメインが Resend で `Verified` になっているか |
| Resend 401 エラー | `RESEND_API_KEY` の値が正しいか（コピーミスに注意） |
| トークンエラー | `TURNSTILE_SECRET_KEY` が Site Key と対応しているか |
| KV / D1 エラー | Binding の Variable name が `TOKENS` / `DB` と完全一致しているか |
| 設定変えても反映しない | **再デプロイ**を実行したか |

---

## 最短チェックリスト（完了確認用）

- [ ] Resend でドメイン追加 (`mail.example.com`)
- [ ] Cloudflare DNS に SPF を追加
- [ ] Cloudflare DNS に DKIM を追加
- [ ] Resend ドメインが `Verified` になった
- [ ] Resend API キーを作成・メモした
- [ ] Cloudflare D1 `hibp_checker` を作成した
- [ ] D1 に `schema.sql` を適用した（テーブル作成）
- [ ] Cloudflare KV `TOKENS` を作成した
- [ ] Cloudflare Turnstile サイトを作成し Site Key / Secret Key をメモした
- [ ] Cloudflare Pages プロジェクトを GitHub 連携で作成した
- [ ] Bindings → `TOKENS`（KV）を接続した
- [ ] Bindings → `DB`（D1）を接続した
- [ ] Variables and Secrets を全件登録した（11 変数）
- [ ] 再デプロイして Status が Success になった
- [ ] フォームからメール送信テストをした
- [ ] 確認メールが届いた
- [ ] 確認リンクをクリックして結果メールが届いた
- [ ] Resend ログで `delivered` を確認した
