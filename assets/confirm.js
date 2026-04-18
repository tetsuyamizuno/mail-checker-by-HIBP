const button = document.getElementById('confirm-button');
const statusEl = document.getElementById('status');

function showStatus(message, type = 'info') {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

function getToken() {
  const url = new URL(window.location.href);
  return url.searchParams.get('token') || '';
}

async function runConfirmation() {
  const token = getToken();
  if (!token) {
    showStatus('トークンが見つかりません。メール内のリンクを開き直してください。', 'error');
    button.disabled = true;
    return;
  }

  button.disabled = true;
  showStatus('確認処理を実行しています…', 'info');

  try {
    const res = await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '確認処理に失敗しました。');

    if (data.alreadyProcessed) {
      showStatus(`この確認リンクはすでに処理済みです。\n結果: ${data.found ? '掲載あり' : '見つかりませんでした'}\n件数: ${data.breachCount}`, 'warn');
      return;
    }

    showStatus(`結果メールを送信しました。\n結果: ${data.found ? '公開された情報漏えい事故に掲載あり' : '公開された情報漏えい事故は見つかりませんでした'}\n件数: ${data.breachCount}`, 'ok');
  } catch (error) {
    showStatus(error.message || '確認処理に失敗しました。', 'error');
    button.disabled = false;
  }
}

button.addEventListener('click', runConfirmation);
runConfirmation();
