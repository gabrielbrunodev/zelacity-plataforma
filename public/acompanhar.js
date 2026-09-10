const lookupForm = document.querySelector('#lookup-form');
const protocolInput = document.querySelector('#protocol-input');
const lookupError = document.querySelector('#lookup-error');
const requestResult = document.querySelector('#request-result');
const publicHistory = document.querySelector('#public-history');
const publicHistoryList = document.querySelector('#public-history-list');

function formatDate(value, withTime = false) {
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value));
}

function setError(message) {
  lookupError.textContent = message;
  lookupError.hidden = false;
}

function renderRequest(request) {
  document.querySelector('#result-protocol').textContent = `SOLICITAÇÃO #${request.protocol}`;
  document.querySelector('#result-status').textContent = request.status;
  document.querySelector('#result-status-detail').textContent = request.status;
  document.querySelector('#result-category').textContent = request.category;
  document.querySelector('#result-location').textContent = request.locationSummary;
  document.querySelector('#result-created-at').textContent = formatDate(request.created_at);
  document.querySelector('#result-updated-at').textContent = formatDate(request.updated_at, true);
  document.querySelector('#result-message').textContent = request.message;
  publicHistoryList.replaceChildren();
  const updates = Array.isArray(request.history) ? request.history : [];
  updates.forEach((update) => {
    const item = document.createElement('li'); item.className = 'audit-item';
    const body = document.createElement('div'); body.className = 'audit-body';
    body.append(Object.assign(document.createElement('strong'), { textContent: update.status || 'Atualização' }), Object.assign(document.createElement('span'), { textContent: formatDate(update.created_at, true) }), Object.assign(document.createElement('p'), { textContent: update.message }));
    item.append(Object.assign(document.createElement('span'), { className: 'audit-dot' }), body);
    publicHistoryList.append(item);
  });
  publicHistory.hidden = updates.length === 0;
  requestResult.hidden = false;
  requestResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  lookupError.hidden = true;
  requestResult.hidden = true;
  const protocol = protocolInput.value.trim().toUpperCase();
  if (!protocol) { setError('Informe o número do protocolo.'); return; }
  try {
    const response = await fetch(`/api/public/requests/${encodeURIComponent(protocol)}`);
    const result = await response.json();
    if (response.status === 404) throw new Error('Protocolo não encontrado. Verifique o número informado.');
    if (!response.ok) throw new Error(result.error || 'Não foi possível consultar a solicitação.');
    renderRequest(result.request);
  } catch (error) {
    setError(error.message);
  }
});

const protocolFromLink = new URLSearchParams(window.location.search).get('protocol');
if (protocolFromLink) {
  protocolInput.value = protocolFromLink.toUpperCase();
  lookupForm.requestSubmit();
}
