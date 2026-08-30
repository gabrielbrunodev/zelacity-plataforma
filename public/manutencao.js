const mobileOrders = document.querySelector('#mobile-orders');
const teamLabel = document.querySelector('#team-label');
const serviceSheet = document.querySelector('#service-sheet');
const finishSheet = document.querySelector('#finish-sheet');
const pendingSheet = document.querySelector('#pending-sheet');
const serviceOrderNumber = document.querySelector('#service-order-number');
const serviceDetails = document.querySelector('#service-details');
const serviceImages = document.querySelector('#service-images');
const serviceHistory = document.querySelector('#service-history');
const serviceActions = document.querySelector('#service-actions');
const finishForm = document.querySelector('#finish-form');
const finishOrderNumber = document.querySelector('#finish-order-number');
const finishError = document.querySelector('#finish-error');
const executedAt = document.querySelector('#executed-at');
const executionLocationButton = document.querySelector('#execution-location-button');
const executionLocationFeedback = document.querySelector('#execution-location-feedback');
const executionLatitude = document.querySelector('#execution-latitude');
const executionLongitude = document.querySelector('#execution-longitude');
const pendingForm = document.querySelector('#pending-form');
const pendingOrderNumber = document.querySelector('#pending-order-number');
const pendingReason = document.querySelector('#pending-reason');
const pendingObservation = document.querySelector('#pending-observation');
const pendingObservationHelp = document.querySelector('#pending-observation-help');
const pendingError = document.querySelector('#pending-error');

const serviceLabels = { ESTRADAS: 'Manutenção de estradas', LAMPADAS: 'Troca de lâmpadas', LUMINARIAS: 'Instalação de luminárias' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const statusLabels = { PROGRAMADA: 'Programada', ATRIBUIDA: 'Atribuída', EM_EXECUCAO: 'Em execução', PENDENCIA_IDENTIFICADA: 'Com pendência', EXECUTADA: 'Executada', CONFERENCIA: 'Em conferência', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
const imageTypeLabels = { SOLICITACAO: 'Foto do cidadão', ANTES_EXECUCAO: 'Foto antes', DEPOIS_EXECUCAO: 'Foto depois' };
let selectedOrder = null;

function formatDate(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sem programação'; }
function localDateTimeValue() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
async function api(path, options = {}) { const response = await fetch(path, options); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.'); return result; }
function el(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }

function createOrderCard(order) {
  const card = el('article', 'mobile-order-card');
  const header = el('div', 'mobile-order-header');
  header.append(el('strong', '', order.number), el('span', `mobile-status status-${String(order.status).toLowerCase()}`, statusLabels[order.status] || order.status));
  const title = el('h2', '', serviceLabels[order.category] || order.category);
  const protocol = el('p', 'mobile-order-protocol', `Protocolo ${order.protocol}`);
  const meta = el('dl', 'mobile-order-meta');
  [
    ['Local', `${order.location}${order.neighborhood ? ` · ${order.neighborhood}` : ''}`],
    ['Referência', order.reference || 'Não informada'],
    ['Prioridade', priorityLabels[order.priority] || order.priority],
    ['Solicitada em', formatDate(order.request_created_at)],
    ['Programada', formatDate(order.scheduled_at)],
  ].forEach(([label, value]) => { const row = document.createElement('div'); row.append(el('dt', '', label), el('dd', '', value)); meta.append(row); });
  const description = el('p', 'mobile-order-description', order.description);
  const open = el('button', 'mobile-action view', 'VER SERVIÇO');
  open.type = 'button'; open.addEventListener('click', () => openService(order));
  const actions = el('div', 'mobile-card-actions');
  actions.append(open);
  if (['PROGRAMADA', 'ATRIBUIDA'].includes(order.status)) {
    const start = el('button', 'mobile-action start', 'INICIAR SERVIÇO');
    start.type = 'button'; start.addEventListener('click', () => startService(order)); actions.append(start);
  }
  if (order.status === 'EM_EXECUCAO') {
    const complete = el('button', 'mobile-action finish', 'CONCLUÍDO');
    complete.type = 'button'; complete.addEventListener('click', () => openFinish(order));
    const pending = el('button', 'mobile-action pending', 'NÃO FOI POSSÍVEL CONCLUIR');
    pending.type = 'button'; pending.addEventListener('click', () => openPending(order));
    actions.append(complete, pending);
  }
  card.append(header, title, protocol, meta, description, actions);
  return card;
}

function groupOrders(workOrders) {
  const groups = [
    ['Pendentes', (order) => ['PROGRAMADA', 'ATRIBUIDA'].includes(order.status)],
    ['Em execução', (order) => order.status === 'EM_EXECUCAO'],
    ['Com pendência', (order) => order.status === 'PENDENCIA_IDENTIFICADA'],
    ['Executados', (order) => ['EXECUTADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA'].includes(order.status)],
  ];
  groups.forEach(([title, matches]) => {
    const entries = workOrders.filter(matches); if (!entries.length) return;
    const section = el('section', 'mobile-order-group'); section.append(el('h2', 'mobile-order-group-title', title));
    entries.forEach((order) => section.append(createOrderCard(order))); mobileOrders.append(section);
  });
}

async function loadOrders() {
  const { workOrders } = await api('/api/work-orders'); mobileOrders.replaceChildren();
  if (!workOrders.length) { mobileOrders.append(el('p', 'mobile-empty', 'Não há ordens de serviço atribuídas à sua equipe.')); return; }
  groupOrders(workOrders);
}

function openSheet(sheet) { sheet.hidden = false; document.body.classList.add('sheet-open'); }
function closeSheet(sheet) { sheet.hidden = true; if ([serviceSheet, finishSheet, pendingSheet].every((item) => item.hidden)) document.body.classList.remove('sheet-open'); }

function mapLink(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  const link = document.createElement('a'); link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`; link.target = '_blank'; link.rel = 'noopener'; link.className = 'button button-secondary button-small'; link.textContent = 'Abrir localização'; return link;
}

function renderServiceDetails(order) {
  serviceDetails.replaceChildren(); serviceImages.replaceChildren(); serviceHistory.replaceChildren(); serviceActions.replaceChildren();
  const info = el('dl', 'mobile-order-meta service-detail-list');
  [
    ['Tipo de serviço', serviceLabels[order.category] || order.category], ['Protocolo', order.protocol], ['Endereço', `${order.location} · ${order.neighborhood || 'Bairro não informado'}`], ['Referência', order.reference || 'Não informada'], ['Prioridade', priorityLabels[order.priority] || order.priority], ['Programada', formatDate(order.scheduled_at)], ['Descrição', order.description],
  ].forEach(([label, value]) => { const row = document.createElement('div'); row.append(el('dt', '', label), el('dd', '', value)); info.append(row); });
  serviceDetails.append(info);
  const requestLocation = mapLink(order.request_latitude, order.request_longitude);
  if (requestLocation) { const location = el('div', 'service-location'); location.append(el('strong', '', 'Localização da solicitação'), requestLocation); serviceDetails.append(location); }
  if (order.images?.length) {
    serviceImages.append(el('h3', '', 'Fotos')); const grid = el('div', 'detail-image-grid');
    order.images.forEach((image) => { const figure = document.createElement('figure'); const photo = document.createElement('img'); photo.src = `/api/images/${image.id}`; photo.alt = imageTypeLabels[image.image_type] || 'Imagem do serviço'; photo.loading = 'lazy'; figure.append(photo, el('figcaption', '', imageTypeLabels[image.image_type] || image.image_type)); grid.append(figure); });
    serviceImages.append(grid);
  }
  if (order.history?.length) {
    serviceHistory.append(el('h3', '', 'Atualizações')); const list = el('ol', 'audit-list');
    order.history.forEach((event) => { const item = el('li', 'audit-item'); const body = el('div', 'audit-body'); body.append(el('strong', '', event.action), el('span', '', `${event.user_name} · ${formatDate(event.created_at)}`)); if (event.observation) body.append(el('p', '', event.observation)); item.append(el('span', 'audit-dot'), body); list.append(item); });
    serviceHistory.append(list);
  }
  if (['PROGRAMADA', 'ATRIBUIDA'].includes(order.status)) {
    const start = el('button', 'mobile-action start', 'INICIAR SERVIÇO'); start.type = 'button'; start.addEventListener('click', () => startService(order)); serviceActions.append(start);
  }
  if (order.status === 'EM_EXECUCAO') {
    const complete = el('button', 'mobile-action finish', 'SERVIÇO CONCLUÍDO'); complete.type = 'button'; complete.addEventListener('click', () => openFinish(order));
    const pending = el('button', 'mobile-action pending', 'NÃO FOI POSSÍVEL CONCLUIR'); pending.type = 'button'; pending.addEventListener('click', () => openPending(order));
    serviceActions.append(complete, pending);
  }
  if (order.status === 'PENDENCIA_IDENTIFICADA') serviceActions.append(el('p', 'execution-record', 'Esta OS retornou para avaliação da administração.'));
  if (order.status === 'EXECUTADA') serviceActions.append(el('p', 'execution-record', 'Execução registrada. A administração fará a conferência antes de encerrar a solicitação.'));
}

async function openService(order) {
  selectedOrder = order; serviceOrderNumber.textContent = order.number; serviceDetails.replaceChildren(el('p', 'mobile-empty', 'Carregando detalhes...')); openSheet(serviceSheet);
  try { const result = await api(`/api/work-orders/${encodeURIComponent(order.number)}`); selectedOrder = result.workOrder; renderServiceDetails(result.workOrder); }
  catch (error) { serviceDetails.replaceChildren(el('p', 'form-error', error.message)); }
}

async function startService(order) {
  const button = serviceActions.querySelector('.start'); if (button) button.disabled = true;
  try { await api(`/api/work-orders/${order.id}/start`, { method: 'POST' }); closeSheet(serviceSheet); await loadOrders(); }
  catch (error) { window.alert(error.message); if (button) button.disabled = false; }
}

function openFinish(order) {
  selectedOrder = order; finishOrderNumber.textContent = order.number; finishForm.reset(); executedAt.value = localDateTimeValue(); finishError.hidden = true; executionLocationFeedback.textContent = ''; closeSheet(serviceSheet); openSheet(finishSheet);
}
function openPending(order) {
  selectedOrder = order; pendingOrderNumber.textContent = order.number; pendingForm.reset(); pendingError.hidden = true; pendingObservation.required = false; pendingObservationHelp.textContent = 'opcional'; closeSheet(serviceSheet); openSheet(pendingSheet);
}

async function initialize() {
  try { const { user } = await api('/api/auth/me'); if (user.role !== 'MANUTENCAO') { window.location.replace('/painel.html'); return; } teamLabel.textContent = user.teamName ? `Equipe ${user.teamName}` : 'Ordens atribuídas à sua equipe'; await loadOrders(); }
  catch { window.location.replace('/login.html'); }
}

finishForm.addEventListener('submit', async (event) => {
  event.preventDefault(); finishError.hidden = true; if (!finishForm.checkValidity()) { finishForm.reportValidity(); return; }
  const submit = finishForm.querySelector('[type="submit"]'); submit.disabled = true;
  try { await api(`/api/work-orders/${selectedOrder.id}/complete`, { method: 'POST', body: new FormData(finishForm) }); closeSheet(finishSheet); await loadOrders(); }
  catch (error) { finishError.textContent = error.message; finishError.hidden = false; }
  finally { submit.disabled = false; }
});

pendingReason.addEventListener('change', () => {
  const required = pendingReason.value === 'OUTRO'; pendingObservation.required = required; pendingObservationHelp.textContent = required ? '* obrigatório para “Outro”' : 'opcional';
});
pendingForm.addEventListener('submit', async (event) => {
  event.preventDefault(); pendingError.hidden = true; if (!pendingForm.checkValidity()) { pendingForm.reportValidity(); return; }
  const submit = pendingForm.querySelector('[type="submit"]'); submit.disabled = true;
  try { await api(`/api/work-orders/${selectedOrder.id}/pending`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(pendingForm))) }); closeSheet(pendingSheet); await loadOrders(); }
  catch (error) { pendingError.textContent = error.message; pendingError.hidden = false; }
  finally { submit.disabled = false; }
});

executionLocationButton.addEventListener('click', () => {
  if (!navigator.geolocation) { executionLocationFeedback.textContent = 'A localização não está disponível neste dispositivo.'; return; }
  executionLocationButton.disabled = true; executionLocationFeedback.textContent = 'Obtendo sua localização…';
  navigator.geolocation.getCurrentPosition(
    (position) => { executionLatitude.value = position.coords.latitude.toFixed(6); executionLongitude.value = position.coords.longitude.toFixed(6); executionLocationFeedback.textContent = 'Localização compartilhada com sucesso.'; executionLocationButton.disabled = false; },
    () => { executionLocationFeedback.textContent = 'A localização não foi compartilhada. Você pode finalizar sem ela.'; executionLocationButton.disabled = false; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
});
document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet({ service: serviceSheet, finish: finishSheet, pending: pendingSheet }[button.dataset.closeSheet])));
document.querySelector('#logout-button').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.replace('/'); });
initialize();
