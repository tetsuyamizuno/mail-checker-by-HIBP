const button = document.getElementById('confirm-button');
const statusEl = document.getElementById('status');
const loadingCard = document.getElementById('loading-card');
const resultCard = document.getElementById('result-card');
const resultHeader = document.getElementById('result-header');
const breachList = document.getElementById('breach-list');
const resultFooter = document.getElementById('result-footer');

function showStatus(message, type = 'info') {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}

function getToken() {
  return new URL(window.location.href).searchParams.get('token') || '';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderResult(data) {
  const { found, breachCount, breaches, email } = data;

  // ローディングカードを非表示、結果カードを表示
  loadingCard.classList.add('hidden');
  resultCard.classList.remove('hidden');

  if (!found) {
    // 漏えいなし
    resultHeader.innerHTML = `
      <div class="result-icon safe">✓</div>
      <h1 class="result-title safe">漏えいは見つかりませんでした</h1>
      <p class="result-subtitle">
        <strong>${escHtml(email)}</strong> は公開されている情報漏えい事故に含まれていませんでした。
      </p>
      <div class="result-banner safe-banner">
        詳細な結果をメールでお送りしました。
      </div>
    `;
  } else {
    // 漏えいあり
    resultHeader.innerHTML = `
      <div class="result-icon danger">🔴</div>
      <h1 class="result-title danger">漏えいが見つかりました</h1>
      <p class="result-subtitle">
        <strong>${escHtml(email)}</strong> は
        <span class="breach-count-highlight">${breachCount}</span>
        件の情報漏えい事故に含まれていました。
      </p>
      <div class="result-banner danger-banner">
        詳細な結果をメールでお送りしました。パスワードの変更をお勧めします。
      </div>
    `;

    // 漏えいカードを描画
    breachList.innerHTML = (breaches || []).map((b) => {
      const tags = (b.dataClasses || [])
        .map((t) => `<span class="breach-tag">${escHtml(t)}</span>`)
        .join('');

      const domain = b.domain ? `<span class="breach-domain">${escHtml(b.domain)}</span>` : '';
      const date = b.breachedDate
        ? `<span class="breach-meta-item">📅 漏えい日: ${escHtml(b.breachedDate)}</span>`
        : '';
      const count = b.pwnCount
        ? `<span class="breach-meta-item">👥 影響件数: <strong>${Number(b.pwnCount).toLocaleString()}</strong> 件</span>`
        : '';

      return `
        <div class="breach-card">
          <div class="breach-card-header">
            <span class="breach-name">${escHtml(b.title || b.name)}</span>
            ${domain}
          </div>
          <div class="breach-meta">
            ${date}
            ${count}
          </div>
          ${tags ? `<div class="breach-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  resultFooter.classList.remove('hidden');
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
      showStatus(
        `この確認リンクはすでに処理済みです。\n結果: ${data.found ? '掲載あり' : '見つかりませんでした'}\n件数: ${data.breachCount}`,
        'warn'
      );
      return;
    }

    renderResult(data);
  } catch (error) {
    showStatus(error.message || '確認処理に失敗しました。', 'error');
    button.disabled = false;
  }
}

button.addEventListener('click', runConfirmation);
runConfirmation();
