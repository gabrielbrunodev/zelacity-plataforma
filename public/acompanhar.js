const lookupForm = document.querySelector('#lookup-form');
const protocolInput = document.querySelector('#protocol-input');
const phoneLastFourInput = document.querySelector('#phone-last-four-input');
const lookupError = document.querySelector('#lookup-error');
const requestResult = document.querySelector('#request-result');

const categoryLabels = { ESTRADAS: 'Manutenção de estradas', LAMPADAS: 'Troca de lâmpadas', LUMINARIAS: 'Instalação de luminárias' };
const statusLabels = { RECEBIDA: 'Solicitação recebida', AGUARDANDO_ANALISE: 'Aguardando análise', EM_ANALISE: 'Em análise', INFORMACOES_ADICIONAIS: 'Informações adicionais solicitadas', APROVADA: 'Aprovada', PROGRAMADA: 'Programada', EM_EXECUCAO: 'Em execução', CONCLUIDA: 'Concluída', INDEFERIDA: 'Indeferida', CANCELADA: 'Cancelada' };
const priorityLabels = { NORMAL: 'Normal', BAIXA: 'Baixa', ALTA: 'Alta', URGENTE: 'Urgente' };
const statusSteps = { RECEBIDA: 0, AGUARDANDO_ANALISE: 1, EM_ANALISE: 1, INFORMACOES_ADICIONAIS: 1, APROVADA: 2, PROGRAMADA: 2, EM_EXECUCAO: 3, CONCLUIDA: 4 };

function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)); }
function setError(message) { lookupError.textContent = message; lookupError.hidden = false; }

function renderHistory(history = []) {
  const list = document.querySelector('#request-history'); list.replaceChildren();
  if (!history.length) { list.append(Object.assign(document.createElement('li'), { className: 'audit-item', textContent: 'Nenhum evento registrado até o momento.' })); return; }
  history.forEach((event) => {
    const item = document.createElement('li'); item.className = 'audit-item';
    const dot = document.createElement('span'); dot.className = 'audit-dot';
    const body = document.createElement('div'); body.className = 'audit-body';
    const action = document.createElement('strong'); action.textContent = event.action;
    const meta = document.createElement('span'); meta.textContent = formatDate(event.created_at);
    body.append(action, meta);
    if (event.observation) { const observation = document.createElement('p'); observation.textContent = event.observation; body.append(observation); }
    item.append(dot, body); list.append(item);
  });
}

function renderRequest(request) {
  document.querySelector('#result-protocol').textContent = request.protocol;
  document.querySelector('#result-status').textContent = statusLabels[request.status] || request.status;
  document.querySelector('#result-category').textContent = categoryLabels[request.category] || request.category;
  document.querySelector('#result-location').textContent = `${request.location} · ${request.neighborhood}`;
  document.querySelector('#result-created-at').textContent = formatDate(request.created_at);
  document.querySelector('#result-priority').textContent = priorityLabels[request.priority] || request.priority;
  document.querySelector('#result-updated-at').textContent = formatDate(request.updated_at);
  renderHistory(request.history);
  const currentStep = statusSteps[request.status];
  document.querySelectorAll('#progress-timeline li').forEach((item, index) => {
    item.classList.toggle('is-complete', Number.isInteger(currentStep) && index < currentStep);
    item.classList.toggle('is-current', Number.isInteger(currentStep) && index === currentStep);
  });
  requestResult.hidden = false; requestResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault(); lookupError.hidden = true; requestResult.hidden = true;
  const protocol = protocolInput.value.trim().toUpperCase();
  const phoneLastFour = phoneLastFourInput.value.replace(/\D/g, '');
  if (!protocol || phoneLastFour.length !== 4) { setError('Informe o protocolo e os últimos 4 dígitos do telefone.'); return; }
  try {
    const response = await fetch(`/api/public/requests/${encodeURIComponent(protocol)}?phoneLastFour=${encodeURIComponent(phoneLastFour)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível consultar a solicitação.');
    renderRequest(result.request);
  } catch (error) { setError(error.message); }
});
