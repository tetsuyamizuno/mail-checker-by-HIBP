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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'user-agent': env.APP_USER_AGENT || 'hibp-checker-pages/1.0',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject,
      text,
      html,
      tags
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}
