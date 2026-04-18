import { nowMs, safeJsonParse } from './util.js';

export async function auditLog(env, entry) {
  const createdAt = entry.createdAtMs || nowMs();
  const metaJson = entry.meta ? JSON.stringify(entry.meta) : null;
  await env.DB.prepare(
    `INSERT INTO audit_logs (
      id, created_at_ms, request_id, event_type,
      email_hash, email_masked, ip_hash, status, message, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      createdAt,
      entry.requestId,
      entry.eventType,
      entry.emailHash || null,
      entry.emailMasked || null,
      entry.ipHash || null,
      entry.status,
      entry.message || null,
      metaJson
    )
    .run();
}

export async function countRecentAcceptedRequests(env, { ipHash, emailHash, now }) {
  const ipWindowMs = 10 * 60 * 1000;
  const emailWindowMs = 15 * 60 * 1000;

  const ipStmt = env.DB.prepare(
    `SELECT COUNT(*) AS cnt
     FROM audit_logs
     WHERE event_type = 'request.accepted'
       AND ip_hash = ?
       AND created_at_ms >= ?`
  ).bind(ipHash, now - ipWindowMs);

  const emailStmt = env.DB.prepare(
    `SELECT COUNT(*) AS cnt
     FROM audit_logs
     WHERE event_type = 'request.accepted'
       AND email_hash = ?
       AND created_at_ms >= ?`
  ).bind(emailHash, now - emailWindowMs);

  const [ipRes, emailRes] = await env.DB.batch([ipStmt, emailStmt]);
  return {
    ipCount: Number(ipRes.results?.[0]?.cnt || 0),
    emailCount: Number(emailRes.results?.[0]?.cnt || 0)
  };
}

export async function getTokenClaim(env, tokenHash) {
  const row = await env.DB.prepare(
    `SELECT token_hash, email_hash, status, request_id, created_at_ms, updated_at_ms, attempts, result_json, error_message
     FROM token_claims
     WHERE token_hash = ?`
  ).bind(tokenHash).first();

  if (!row) return null;
  return {
    ...row,
    result: safeJsonParse(row.result_json, null)
  };
}

export async function claimOrResumeToken(env, { tokenHash, emailHash, requestId, now }) {
  const existing = await getTokenClaim(env, tokenHash);
  if (!existing) {
    try {
      await env.DB.prepare(
        `INSERT INTO token_claims (
          token_hash, email_hash, status, request_id,
          created_at_ms, updated_at_ms, attempts
        ) VALUES (?, ?, 'processing', ?, ?, ?, 1)`
      ).bind(tokenHash, emailHash || null, requestId, now, now).run();
      return { state: 'processing-acquired' };
    } catch {
      const afterRace = await getTokenClaim(env, tokenHash);
      if (afterRace) {
        return normalizeClaim(afterRace);
      }
      throw new Error('Failed to claim token');
    }
  }

  if (existing.status === 'failed') {
    await env.DB.prepare(
      `UPDATE token_claims
       SET status = 'processing', request_id = ?, updated_at_ms = ?, attempts = attempts + 1, error_message = NULL
       WHERE token_hash = ?`
    ).bind(requestId, now, tokenHash).run();
    return { state: 'processing-acquired' };
  }

  return normalizeClaim(existing);
}

function normalizeClaim(row) {
  if (row.status === 'completed') {
    return { state: 'completed', result: row.result };
  }
  if (row.status === 'processing') {
    return { state: 'already-processing' };
  }
  return { state: row.status || 'unknown' };
}

export async function completeTokenClaim(env, { tokenHash, result, now }) {
  await env.DB.prepare(
    `UPDATE token_claims
     SET status = 'completed', updated_at_ms = ?, result_json = ?, error_message = NULL
     WHERE token_hash = ?`
  ).bind(now, JSON.stringify(result), tokenHash).run();
}

export async function failTokenClaim(env, { tokenHash, errorMessage, now }) {
  await env.DB.prepare(
    `UPDATE token_claims
     SET status = 'failed', updated_at_ms = ?, error_message = ?
     WHERE token_hash = ?`
  ).bind(now, errorMessage, tokenHash).run();
}
