import { auditLog, claimOrResumeToken, completeTokenClaim, failTokenClaim } from '../_lib/db.js';
import { lookupHibp, sendResendEmail } from '../_lib/services.js';
import {
  getClientIp,
  json,
  nowMs,
  readJson,
  requireEnv,
  safeJsonParse,
  sha256Hex
} from '../_lib/util.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const ipHash = await sha256Hex(ip);
  const startedAt = nowMs();

  try {
    requireEnv(env, ['DB', 'TOKENS', 'HIBP_API_KEY', 'RESEND_API_KEY', 'FROM_EMAIL']);

    const body = await readJson(request);
    const rawToken = String(body?.token || '').trim();
    if (!rawToken || rawToken.length < 32) {
      return json({ error: 'トークンが不正です。' }, 400);
    }

    const tokenHash = await sha256Hex(rawToken);
    const kvKey = `confirm:${tokenHash}`;
    const tokenRaw = await env.TOKENS.get(kvKey);

    if (!tokenRaw) {
      await auditLog(env, {
        requestId,
        eventType: 'confirm.invalid',
        ipHash,
        status: 'expired_or_missing',
        message: 'Token missing or expired'
      });
      return json({ error: 'リンクの有効期限が切れているか、すでに処理済みです。' }, 400);
    }

    const tokenData = safeJsonParse(tokenRaw, null);
    if (!tokenData?.email) {
      await auditLog(env, {
        requestId,
        eventType: 'confirm.invalid',
        ipHash,
        status: 'token_corrupted',
        message: 'Token payload missing email'
      });
      return json({ error: 'トークン情報が壊れています。' }, 400);
    }

    const email = tokenData.email;
    const emailHash = tokenData.emailHash || (await sha256Hex(email));
    const emailMasked = tokenData.emailMasked || email.replace(/(^.).+(@.*$)/, '$1***$2');

    await auditLog(env, {
      requestId,
      eventType: 'confirm.received',
      emailHash,
      emailMasked,
      ipHash,
      status: 'ok',
      message: 'Confirmation request received'
    });

    const claim = await claimOrResumeToken(env, {
      tokenHash,
      emailHash,
      requestId,
      now: startedAt
    });

    if (claim.state === 'completed') {
      return json({ ok: true, alreadyProcessed: true, ...claim.result });
    }

    if (claim.state === 'already-processing') {
      return json({ error: '現在処理中です。数秒待って再読み込みしてください。' }, 409);
    }

    const hibp = await lookupHibp(email, env);

    await auditLog(env, {
      requestId,
      eventType: 'hibp.checked',
      emailHash,
      emailMasked,
      ipHash,
      status: 'ok',
      message: 'HIBP lookup completed',
      meta: { found: hibp.found, breachCount: hibp.breaches.length }
    });

    const topBreaches = hibp.breaches.slice(0, 10).map((b) => ({
      name: b.Name,
      title: b.Title,
      domain: b.Domain,
      breachedDate: b.BreachDate,
      pwnCount: b.PwnCount
    }));

    const summary = {
      email: emailMasked,
      found: hibp.found,
      breachCount: hibp.breaches.length,
      breaches: topBreaches
    };

    const textList = topBreaches.length
      ? topBreaches.map((b, i) => `${i + 1}. ${b.title || b.name} / ${b.breachedDate || '日付不明'} / ${Number(b.pwnCount || 0).toLocaleString()}件`).join('\n')
      : '該当なし';

    const htmlList = topBreaches.length
      ? topBreaches.map((b) => `<li><strong>${escapeHtml(b.title || b.name)}</strong> / ${escapeHtml(b.breachedDate || '日付不明')} / ${Number(b.pwnCount || 0).toLocaleString()}件</li>`).join('')
      : '<li>該当なし</li>';

    const subject = hibp.found
      ? `【要確認】${emailMasked} は情報漏えい事故に掲載されています`
      : `【確認結果】${emailMasked} の情報漏えい事故は見つかりませんでした`;

    const text = [
      `対象メールアドレス: ${emailMasked}`,
      '',
      hibp.found
        ? '公開されている情報漏えい事故データに掲載がありました。'
        : '公開されている情報漏えい事故データは見つかりませんでした。',
      '',
      `検出件数: ${hibp.breaches.length}`,
      textList,
      '',
      'Data source: Have I Been Pwned',
      'https://haveibeenpwned.com/'
    ].join('\n');

    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.7;color:#111">
        <h2>メールアドレス漏えいチェック結果</h2>
        <p><strong>対象:</strong> ${escapeHtml(emailMasked)}</p>
        <p>${hibp.found ? '公開されている情報漏えい事故データに掲載がありました。' : '公開されている情報漏えい事故は見つかりませんでした。'}</p>
        <p><strong>検出件数:</strong> ${hibp.breaches.length}</p>
        <ul>${htmlList}</ul>
        <hr />
        <p style="font-size:12px;color:#666">Data source: <a href="https://haveibeenpwned.com/">Have I Been Pwned</a></p>
      </div>
    `;

    const resendData = await sendResendEmail(env, {
      idempotencyKey: `result:${tokenHash}`,
      to: email,
      subject,
      text,
      html,
      tags: [
        { name: 'flow', value: 'result' },
        { name: 'request', value: 'hibp_check' }
      ]
    });

    await completeTokenClaim(env, {
      tokenHash,
      result: {
        ...summary,
        resendId: resendData?.id || null,
        completed: true
      },
      now: nowMs()
    });

    await env.TOKENS.delete(kvKey);

    await auditLog(env, {
      requestId,
      eventType: 'result.mail.sent',
      emailHash,
      emailMasked,
      ipHash,
      status: 'ok',
      message: 'Result email sent',
      meta: { resendId: resendData?.id || null, breachCount: hibp.breaches.length }
    });

    return json({ ok: true, ...summary });
  } catch (error) {
    console.error('confirm endpoint error', error);
    const body = await request.clone().json().catch(() => null);
    const rawToken = String(body?.token || '').trim();
    if (rawToken) {
      const tokenHash = await sha256Hex(rawToken).catch(() => null);
      if (tokenHash) {
        await failTokenClaim(env, {
          tokenHash,
          errorMessage: error.message || 'Unknown error',
          now: nowMs()
        }).catch(() => {});
      }
    }

    await auditLog(env, {
      requestId,
      eventType: 'confirm.error',
      ipHash,
      status: 'error',
      message: error.message || 'Unknown error'
    }).catch(() => {});

    return json({ error: '確認処理に失敗しました。時間をおいて再度お試しください。' }, 500);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
