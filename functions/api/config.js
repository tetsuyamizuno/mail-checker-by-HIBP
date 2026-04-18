export async function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      appName: 'メールアドレス漏えいチェッカー by HIBP',
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || ''
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}
