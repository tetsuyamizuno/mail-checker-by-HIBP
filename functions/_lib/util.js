export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

export function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '0.0.0.0';
}

export function nowMs() {
  return Date.now();
}

export function getBaseUrl(request, env) {
  return (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return 'invalid';
  const first = local[0] || '*';
  const maskedLocal = first + '*'.repeat(Math.max(1, Math.min(local.length - 1, 6)));
  return `${maskedLocal}@${domain}`;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function requireEnv(env, names) {
  for (const name of names) {
    if (!env[name]) {
      throw new Error(`${name} is not configured`);
    }
  }
}

export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
