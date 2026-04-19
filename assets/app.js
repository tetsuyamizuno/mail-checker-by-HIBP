const form = document.getElementById('request-form');
const emailInput = document.getElementById('email');
const submitButton = document.getElementById('submit-button');
const statusEl = document.getElementById('status');

function showStatus(message, type = 'info') {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  showStatus('送信中です…', 'info');

  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput.value.trim()
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '送信に失敗しました。');

    showStatus(data.message || '確認メールを送信しました。', 'ok');
    form.reset();
  } catch (error) {
    showStatus(error.message || '送信に失敗しました。', 'error');
  } finally {
    submitButton.disabled = false;
  }
});
