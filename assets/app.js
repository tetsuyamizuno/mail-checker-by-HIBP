const form = document.getElementById('request-form');
const emailInput = document.getElementById('email');
const submitButton = document.getElementById('submit-button');
const statusEl = document.getElementById('status');
const slot = document.getElementById('turnstile-slot');

let turnstileWidgetId = null;

function showStatus(message, type = 'info') {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

function resetTurnstile() {
  if (window.turnstile && turnstileWidgetId !== null) {
    window.turnstile.reset(turnstileWidgetId);
  }
}

async function loadConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('設定の読み込みに失敗しました。');
  return await res.json();
}

async function setupTurnstile() {
  const config = await loadConfig();
  if (!config.turnstileSiteKey) {
    throw new Error('TURNSTILE_SITE_KEY が設定されていません。');
  }

  document.title = config.appName;

  await waitForTurnstile();
  turnstileWidgetId = window.turnstile.render(slot, {
    sitekey: config.turnstileSiteKey,
    theme: 'dark'
  });
}

function waitForTurnstile() {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const timer = setInterval(() => {
      retries += 1;
      if (window.turnstile) {
        clearInterval(timer);
        resolve();
      } else if (retries > 50) {
        clearInterval(timer);
        reject(new Error('Turnstile の読み込みに失敗しました。'));
      }
    }, 100);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  showStatus('送信中です…', 'info');

  try {
    if (!window.turnstile || turnstileWidgetId === null) {
      throw new Error('CAPTCHA が初期化されていません。');
    }

    const turnstileToken = window.turnstile.getResponse(turnstileWidgetId);
    if (!turnstileToken) {
      throw new Error('CAPTCHA の確認を完了してください。');
    }

    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        turnstileToken
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '送信に失敗しました。');

    showStatus(data.message || '確認メールを送信しました。', 'ok');
    form.reset();
    resetTurnstile();
  } catch (error) {
    showStatus(error.message || '送信に失敗しました。', 'error');
    resetTurnstile();
  } finally {
    submitButton.disabled = false;
  }
});

setupTurnstile().catch((error) => {
  showStatus(error.message || '初期化に失敗しました。', 'error');
});
