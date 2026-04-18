import { requireEnv } from './util.js';

export async function verifyTurnstile(env, { token, remoteip }) {
  requireEnv(env, ['TURNSTILE_SECRET_KEY']);

  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  if (remoteip) form.set('remoteip', remoteip);
  form.set('idempotency_key', crypto.randomUUID());

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });

  if (!res.ok) {
    throw new Error(`Turnstile validation failed with status ${res.status}`);
  }

  return await res.json();
}

export async function lookupHibp(email, env) {
  requireEnv(env, ['HIBP_API_KEY']);

  const res = await fetch(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    {
      headers: {
        'hibp-api-key': env.HIBP_API_KEY,
        'user-agent': env.APP_USER_AGENT || 'hibp-checker-pages/1.0',
        accept: 'application/json'
      }
    }
  );

  if (res.status === 404) {
    return { found: false, breaches: [] };
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after') || 'unknown';
    throw new Error(`HIBP rate limit exceeded. retry-after=${retryAfter}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HIBP API error ${res.status}: ${text}`);
  }

  const breaches = await res.json();
  return { found: true, breaches };
}

export async function sendResendEmail(env, { idempotencyKey, to, subject, text, html, tags = [] }) {
  requireEnv(env, ['RESEND_API_KEY', 'FROM_EMAIL']);

  // FROM_EMAIL must use a Resend-verified domain, e.g. "App Name <noreply@mail.example.com>"
  const fromEmail = env.FROM_EMAIL;
  if (!fromEmail.includes('@')) {
    throw new Error(
      'FROM_EMAIL が正しい形式ではありません。Resend で検証済みドメインのアドレスを設定してください。例: HIBP Checker <noreply@mail.example.com>'
    );
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'user-agent': env.APP_USER_AGENT || 'hibp-checker-pages/1.0',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject,
      text,
      html,
      tags
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Provide actionable error messages for common Resend failures
    const detail = JSON.stringify(data);
    if (res.status === 401) {
      throw new Error(`Resend 認証エラー (401): RESEND_API_KEY が正しいか確認してください。詳細: ${detail}`);
    }
    if (res.status === 422) {
      throw new Error(`Resend 送信エラー (422): FROM_EMAIL が Resend で verified になっているか確認してください。詳細: ${detail}`);
    }
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }
  return data;
}
