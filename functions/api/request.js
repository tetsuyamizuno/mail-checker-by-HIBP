import { auditLog, countRecentAcceptedRequests } from '../_lib/db.js';
import { sendResendEmail, verifyTurnstile } from '../_lib/services.js';
import {
  getBaseUrl,
  getClientIp,
  isValidEmail,
  json,
  maskEmail,
  nowMs,
  randomToken,
  readJson,
  requireEnv,
  sha256Hex
} from '../_lib/util.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();
  const startedAt = nowMs();
  const ip = getClientIp(request);
  const ipHash = await sha256Hex(ip);

  try {
    requireEnv(env, [
      'DB',
      'TOKENS',
      'APP_BASE_URL',
      'TURNSTILE_SECRET_KEY',
      'RESEND_API_KEY',
      'FROM_EMAIL',
      'HIBP_API_KEY'
    ]);

    const body = await readJson(request);
    const email = String(body?.email || '').trim().toLowerCase();
    const turnstileToken = String(body?.turnstileToken || '');

    const emailHash = await sha256Hex(email);
    const emailMasked = maskEmail(email);

    await auditLog(env, {
      requestId,
      eventType: 'request.received',
      emailHash,
      emailMasked,
      ipHash,
      status: 'ok',
      message: 'Request received'
    });

    if (!isValidEmail(email)) {
      await auditLog(env, {
        requestId,
        eventType: 'request.rejected',
        emailHash,
        emailMasked,
        ipHash,
        status: 'invalid_email',
        message: 'Invalid email format'
      });
      return json({ error: 'メールアドレスの形式が正しくありません。' }, 400);
    }

    if (!turnstileToken) {
      await auditLog(env, {
        requestId,
        eventType: 'request.rejected',
        emailHash,
        emailMasked,
        ipHash,
        status: 'missing_turnstile',
        message: 'Turnstile token is missing'
      });
      return json({ error: 'CAPTCHA の確認が必要です。' }, 400);
    }

    const turnstile = await verifyTurnstile(env, { token: turnstileToken, remoteip: ip });
    if (!turnstile.success) {
      await auditLog(env, {
        requestId,
        eventType: 'request.rejected',
        emailHash,
        emailMasked,
        ipHash,
        status: 'turnstile_failed',
        message: 'Turnstile verification failed',
        meta: { errorCodes: turnstile['error-codes'] || [] }
      });
      return json({ error: 'CAPTCHA の検証に失敗しました。再度お試しください。' }, 403);
    }

    const counts = await countRecentAcceptedRequests(env, {
      ipHash,
      emailHash,
      now: startedAt
    });

    const ipLimit = Number(env.MAX_REQUESTS_PER_10_MIN_IP || 5);
    const emailLimit = Number(env.MAX_REQUESTS_PER_15_MIN_EMAIL || 3);
    const cooldownSeconds = Number(env.EMAIL_COOLDOWN_SECONDS || 300);
    const cooldownKey = `cooldown:confirm:${emailHash}`;
    const existingCooldown = await env.TOKENS.get(cooldownKey);

    if (counts.ipCount >= ipLimit || counts.emailCount >= emailLimit || existingCooldown) {
      await auditLog(env, {
        requestId,
        eventType: 'request.rate_limited',
        emailHash,
        emailMasked,
        ipHash,
        status: 'blocked',
        message: 'Rate limit triggered',
        meta: { ipCount: counts.ipCount, emailCount: counts.emailCount, cooldown: Boolean(existingCooldown) }
      });
      return json({ error: '時間をおいてから再度お試しください。' }, 429);
    }

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const tokenTtl = Number(env.CONFIRM_TOKEN_TTL_SECONDS || 900);
    const confirmUrl = `${getBaseUrl(request, env)}/confirm.html?token=${encodeURIComponent(rawToken)}`;

    await env.TOKENS.put(
      `confirm:${tokenHash}`,
      JSON.stringify({
        email,
        emailHash,
        emailMasked,
        createdAtMs: startedAt,
        requestId
      }),
      { expirationTtl: tokenTtl }
    );

    await env.TOKENS.put(cooldownKey, '1', { expirationTtl: cooldownSeconds });

    await auditLog(env, {
      requestId,
      eventType: 'request.accepted',
      emailHash,
      emailMasked,
      ipHash,
      status: 'ok',
      message: 'Accepted after Turnstile and rate-limit checks'
    });

    const subject = '【要確認】メールアドレス漏えいチェックの確認リンク';
    const text = [
      `${emailMasked} 宛の確認メールです。`,
      '',
      'このリンクを開くと、メールアドレスの漏えいチェックを実行し、結果をメールで送信します。',
      confirmUrl,
      '',
      `有効期限: ${Math.floor(tokenTtl / 60)} 分`,
      '',
      '心当たりがない場合は、このメールを破棄してください。'
    ].join('\n');

    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.7;color:#111">
        <h2>メールアドレス漏えいチェックの確認</h2>
        <p><strong>宛先:</strong> ${emailMasked}</p>
        <p>以下のボタンから確認を完了すると、Have I Been Pwned で漏えい状況を確認し、結果をメールで送信します。</p>
        <p><a href="${confirmUrl}" style="display:inline-block;padding:12px 18px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none">確認してチェックを実行</a></p>
        <p>有効期限: ${Math.floor(tokenTtl / 60)} 分</p>
        <p style="font-size:12px;color:#666">心当たりがない場合は、このメールを破棄してください。</p>
      </div>
    `;

    await sendResendEmail(env, {
      idempotencyKey: `confirm:${tokenHash}`,
      to: email,
      subject,
      text,
      html,
      tags: [
        { name: 'flow', value: 'confirm' },
        { name: 'request', value: 'hibp_check' }
      ]
    });

    await auditLog(env, {
      requestId,
      eventType: 'confirm.mail.sent',
      emailHash,
      emailMasked,
      ipHash,
      status: 'ok',
      message: 'Confirmation email sent'
    });

    return json({
      ok: true,
      message: '確認メールを送信しました。メール内のリンクから続行してください。'
    });
  } catch (error) {
    console.error('request endpoint error', error);
    await auditLog(env, {
      requestId,
      eventType: 'request.error',
      ipHash,
      status: 'error',
      message: error.message || 'Unknown error'
    }).catch(() => {});
    return json({ error: '確認メールの送信に失敗しました。設定を確認してください。' }, 500);
  }
}
