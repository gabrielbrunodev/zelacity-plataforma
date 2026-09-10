const mobileOrders = document.querySelector('#mobile-orders');
const ordersSection = document.querySelector('#orders-section');
const showOrdersButton = document.querySelector('#show-orders-button');
const ordersTotal = document.querySelector('#orders-total');
const workerGreeting = document.querySelector('#worker-greeting');
const teamLabel = document.querySelector('#team-label');
const pendingCount = document.querySelector('#pending-count');
const inProgressCount = document.querySelector('#in-progress-count');
const completedTodayCount = document.querySelector('#completed-today-count');
const serviceSheet = document.querySelector('#service-sheet');
const observationSheet = document.querySelector('#observation-sheet');
const photoSheet = document.querySelector('#photo-sheet');
const finishSheet = document.querySelector('#finish-sheet');
const pendingSheet = document.querySelector('#pending-sheet');
const serviceOrderNumber = document.querySelector('#service-order-number');
const serviceDetails = document.querySelector('#service-details');
const serviceImages = document.querySelector('#service-images');
const serviceHistory = document.querySelector('#service-history');
const serviceActions = document.querySelector('#service-actions');
const observationForm = document.querySelector('#observation-form');
const observationOrderNumber = document.querySelector('#observation-order-number');
const observationError = document.querySelector('#observation-error');
const photoForm = document.querySelector('#photo-form');
const photoOrderNumber = document.querySelector('#photo-order-number');
const photoError = document.querySelector('#photo-error');
const finishForm = document.querySelector('#finish-form');
const finishOrderNumber = document.querySelector('#finish-order-number');
const finishError = document.querySelector('#finish-error');
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
const notificationsButton = document.querySelector('#notifications-button');
const notificationsCount = document.querySelector('#notifications-count');
const notificationsPanel = document.querySelector('#notifications-panel');
const notificationsList = document.querySelector('#notifications-list');
const markNotificationsRead = document.querySelector('#mark-notifications-read');

const serviceLabels = { ESTRADAS: 'Manutenção de estrada', LAMPADAS: 'Iluminação pública', LUMINARIAS: 'Instalação de luminária', OUTROS: 'Outros' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const requestStatusLabels = { RECEBIDA: 'Recebida', EM_ANALISE: 'Em análise', ENCAMINHADA: 'Encaminhada', PENDENTE: 'Pendente', EM_ATENDIMENTO: 'Em atendimento', CONCLUIDA: 'Concluída', NAO_REALIZADA: 'Não realizada', CANCELADA: 'Cancelada' };
const imageTypeLabels = { SOLICITACAO: 'Foto da solicitação', ANTES_EXECUCAO: 'Foto de campo', DEPOIS_EXECUCAO: 'Foto depois' };
const historyTypeLabels = { SOLICITACAO_CRIADA: 'Solicitação criada', ORDEM_SERVICO_CRIADA: 'OS criada', STATUS_ALTERADO: 'Status alterado', ATRIBUICAO: 'Atribuição', REDISTRIBUICAO: 'Redistribuição', PRIORIDADE_ALTERADA: 'Prioridade alterada', PRAZO_ALTERADO: 'Prazo alterado', SERVICO_INICIADO: 'Serviço iniciado', SERVICO_CONCLUIDO: 'Serviço concluído', IMPOSSIBILIDADE_INFORMADA: 'Impossibilidade informada', FOTO_ADICIONADA: 'Foto adicionada', OBSERVACAO_ADICIONADA: 'Observação adicionada', ATUALIZACAO_PUBLICA: 'Atualização pública', PROTOCOLO_1DOC_VINCULADO: 'Protocolo 1Doc vinculado', SOLICITACAO_REABERTA: 'Solicitação reaberta', ATUALIZACAO: 'Atualização registrada' };
const terminalOrderStatuses = new Set(['EXECUTADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA']);
let selectedOrder = null;
let allOrders = [];

function el(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value));
}

function localDateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result;
}

function orderStatus(order) {
  return requestStatusLabels[order.request_status] || order.request_status || 'Encaminhada';
}

function createOrderCard(order) {
  const card = el('article', 'mobile-order-card');
  const header = el('div', 'mobile-order-header');
  header.append(el('strong', '', `#${order.protocol}`), el('span', `mobile-status request-status-${String(order.request_status || '').toLowerCase()}`, orderStatus(order)));
  card.append(header, el('h2', '', serviceLabels[order.category] || order.category));
  const meta = el('dl', 'mobile-order-meta');
  [
    ['Bairro', order.neighborhood || 'Não informado'],
    ['Data', formatDate(order.request_created_at)],
    ['Prioridade', priorityLabels[order.priority] || order.priority],
    ['Status', orderStatus(order)],
  ].forEach(([label, value]) => { const row = document.createElement('div'); row.append(el('dt', '', label), el('dd', '', value)); meta.append(row); });
  const open = el('button', 'mobile-action view', 'VER SOLICITAÇÃO');
  open.type = 'button';
  open.addEventListener('click', () => openService(order));
  card.append(meta, open);
  return card;
}

function renderOrders() {
  mobileOrders.replaceChildren();
  ordersTotal.textContent = `${allOrders.length} no total`;
  if (!allOrders.length) {
    mobileOrders.append(el('p', 'mobile-empty', 'Não há solicitações atribuídas à sua equipe.'));
    return;
  }
  allOrders.forEach((order) => mobileOrders.append(createOrderCard(order)));
}

function updateSummary() {
  const today = localDateKey(new Date());
  pendingCount.textContent = String(allOrders.filter((order) => ['PROGRAMADA', 'ATRIBUIDA', 'PENDENCIA_IDENTIFICADA'].includes(order.status)).length);
  inProgressCount.textContent = String(allOrders.filter((order) => order.status === 'EM_EXECUCAO').length);
  completedTodayCount.textContent = String(allOrders.filter((order) => ['EXECUTADA', 'CONFERENCIA', 'CONCLUIDA'].includes(order.status) && localDateKey(order.executed_at || order.updated_at) === today).length);
}

async function loadOrders() {
  const { workOrders } = await api('/api/work-orders');
  allOrders = workOrders;
  updateSummary();
  renderOrders();
}

function renderNotifications(notifications, unreadCount) {
  notificationsCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  notificationsCount.hidden = unreadCount === 0;
  notificationsList.replaceChildren();
  if (!notifications.length) { notificationsList.append(el('p', 'mobile-empty', 'Você não possui notificações.')); return; }
  notifications.forEach((notification) => {
    const item = el('article', `notification-item${notification.read_at ? '' : ' is-unread'}`);
    item.append(el('strong', '', notification.title), el('p', '', notification.message), el('small', '', formatDate(notification.created_at, true)));
    if (!notification.read_at) {
      const read = el('button', 'button button-secondary button-small', 'Marcar como lida'); read.type = 'button';
      read.addEventListener('click', async () => { try { await api(`/api/notifications/${notification.id}/read`, { method: 'PATCH' }); await loadNotifications(); } catch (error) { window.alert(error.message); } }); item.append(read);
    }
    notificationsList.append(item);
  });
}

async function loadNotifications() {
  const { notifications, unreadCount } = await api('/api/notifications');
  renderNotifications(notifications, unreadCount);
}

function openSheet(sheet) {
  sheet.hidden = false;
  document.body.classList.add('sheet-open');
}

function closeSheet(sheet) {
  sheet.hidden = true;
  if ([serviceSheet, observationSheet, photoSheet, finishSheet, pendingSheet].every((item) => item.hidden)) document.body.classList.remove('sheet-open');
}

function mapLink(order) {
  const coordinates = order.request_latitude !== null && order.request_latitude !== undefined && order.request_longitude !== null && order.request_longitude !== undefined;
  const query = coordinates ? `${order.request_latitude},${order.request_longitude}` : [order.location, order.neighborhood].filter(Boolean).join(', ');
  if (!query) return null;
  const link = document.createElement('a');
  link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'mobile-action map';
  link.textContent = 'ABRIR NO MAPA';
  return link;
}

function addAction(label, className, callback) {
  const button = el('button', `mobile-action ${className}`, label);
  button.type = 'button';
  button.addEventListener('click', callback);
  serviceActions.append(button);
}

function renderServiceDetails(order) {
  serviceDetails.replaceChildren(); serviceImages.replaceChildren(); serviceHistory.replaceChildren(); serviceActions.replaceChildren();
  const info = el('dl', 'mobile-order-meta service-detail-list');
  [
    ['Protocolo', `#${order.protocol}`],
    ['Categoria', serviceLabels[order.category] || order.category],
    ['Tipo de serviço', serviceLabels[order.category] || order.category],
    ['Endereço', order.location],
    ['Bairro', order.neighborhood || 'Não informado'],
    ['Referência', order.reference || 'Não informada'],
    ['Descrição', order.description],
    ['Observação da execução', order.execution_observation || 'Ainda não concluída.'],
    ['Materiais utilizados', order.execution_materials_used || 'Não informado.'],
  ].forEach(([label, value]) => { const row = document.createElement('div'); row.append(el('dt', '', label), el('dd', '', value || '—')); info.append(row); });
  serviceDetails.append(info);
  const map = mapLink(order);
  if (map) { const location = el('div', 'service-location'); location.append(el('strong', '', 'Localização'), map); serviceDetails.append(location); }

  if (order.images?.length) {
    serviceImages.append(el('h3', '', 'Fotos')); const grid = el('div', 'detail-image-grid');
    order.images.forEach((image) => { const figure = document.createElement('figure'); const photo = document.createElement('img'); photo.alt = imageTypeLabels[image.image_type] || 'Imagem do serviço'; photo.loading = 'lazy'; window.zelacityLoadProtectedImage(photo, `/api/images/${image.id}`).catch(() => { photo.alt = 'Imagem indisponível.'; }); figure.append(photo, el('figcaption', '', imageTypeLabels[image.image_type] || image.image_type)); grid.append(figure); });
    serviceImages.append(grid);
  }
  if (order.history?.length) {
    serviceHistory.append(el('h3', '', 'Observações e atualizações')); const list = el('ol', 'audit-list');
    order.history.forEach((event) => { const item = el('li', 'audit-item'); const body = el('div', 'audit-body'); body.append(el('strong', '', event.action), el('small', 'audit-change', historyTypeLabels[event.event_type] || 'Atualização registrada'), el('span', '', `${event.user_name} · ${formatDate(event.created_at, true)}`)); if (event.observation) body.append(el('p', '', event.observation)); item.append(el('span', 'audit-dot'), body); list.append(item); });
    serviceHistory.append(list);
  }

  if (['PROGRAMADA', 'ATRIBUIDA'].includes(order.status)) addAction('INICIAR SERVIÇO', 'start', () => startService(order));
  if (!terminalOrderStatuses.has(order.status)) {
    addAction('ADICIONAR FOTO', 'secondary', () => openPhoto(order));
    addAction('ADICIONAR OBSERVAÇÃO', 'secondary', () => openObservation(order));
  }
  if (order.status === 'EM_EXECUCAO') {
    addAction('CONCLUIR SERVIÇO', 'finish', () => openFinish(order));
    addAction('NÃO FOI POSSÍVEL REALIZAR', 'pending', () => openPending(order));
  }
  if (order.status === 'PENDENCIA_IDENTIFICADA') serviceActions.append(el('p', 'execution-record', 'A solicitação está pendente de avaliação da administração.'));
  if (terminalOrderStatuses.has(order.status)) serviceActions.append(el('p', 'execution-record', 'Este serviço não possui novas ações de campo.'));
}

async function openService(order) {
  selectedOrder = order;
  serviceOrderNumber.textContent = `#${order.protocol}`;
  serviceDetails.replaceChildren(el('p', 'mobile-empty', 'Carregando detalhes...'));
  openSheet(serviceSheet);
  try {
    const result = await api(`/api/work-orders/${encodeURIComponent(order.number)}`);
    selectedOrder = result.workOrder;
    renderServiceDetails(selectedOrder);
  } catch (error) { serviceDetails.replaceChildren(el('p', 'form-error', error.message)); }
}

async function startService(order) {
  const button = serviceActions.querySelector('.start');
  if (button) button.disabled = true;
  try { await api(`/api/work-orders/${order.id}/start`, { method: 'POST' }); closeSheet(serviceSheet); await loadOrders(); }
  catch (error) { window.alert(error.message); if (button) button.disabled = false; }
}

function openObservation(order) {
  selectedOrder = order; observationOrderNumber.textContent = `#${order.protocol}`; observationForm.reset(); observationError.hidden = true; closeSheet(serviceSheet); openSheet(observationSheet);
}

function openPhoto(order) {
  selectedOrder = order; photoOrderNumber.textContent = `#${order.protocol}`; photoForm.reset(); photoError.hidden = true; closeSheet(serviceSheet); openSheet(photoSheet);
}

function openFinish(order) {
  selectedOrder = order; finishOrderNumber.textContent = `#${order.protocol}`; finishForm.reset(); finishError.hidden = true; executionLocationFeedback.textContent = ''; closeSheet(serviceSheet); openSheet(finishSheet);
}

function openPending(order) {
  selectedOrder = order; pendingOrderNumber.textContent = `#${order.protocol}`; pendingForm.reset(); pendingError.hidden = true; pendingObservation.required = false; pendingObservationHelp.textContent = 'opcional'; closeSheet(serviceSheet); openSheet(pendingSheet);
}

showOrdersButton.addEventListener('click', () => {
  const willShow = ordersSection.hidden;
  ordersSection.hidden = !willShow;
  showOrdersButton.setAttribute('aria-expanded', String(willShow));
  showOrdersButton.textContent = willShow ? 'OCULTAR MINHAS SOLICITAÇÕES' : 'VER MINHAS SOLICITAÇÕES';
  if (willShow) ordersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

notificationsButton.addEventListener('click', async () => {
  const willShow = notificationsPanel.hidden;
  notificationsPanel.hidden = !willShow;
  notificationsButton.setAttribute('aria-expanded', String(willShow));
  if (willShow) { await loadNotifications(); notificationsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

markNotificationsRead.addEventListener('click', async () => {
  try { await api('/api/notifications/read-all', { method: 'POST' }); await loadNotifications(); } catch (error) { window.alert(error.message); }
});

observationForm.addEventListener('submit', async (event) => {
  event.preventDefault(); observationError.hidden = true; if (!observationForm.checkValidity()) { observationForm.reportValidity(); return; }
  const submit = observationForm.querySelector('[type="submit"]'); submit.disabled = true;
  try { await api(`/api/work-orders/${selectedOrder.id}/updates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'OBSERVACAO', description: new FormData(observationForm).get('description') }) }); closeSheet(observationSheet); await loadOrders(); }
  catch (error) { observationError.textContent = error.message; observationError.hidden = false; }
  finally { submit.disabled = false; }
});

photoForm.addEventListener('submit', async (event) => {
  event.preventDefault(); photoError.hidden = true; if (!photoForm.checkValidity()) { photoForm.reportValidity(); return; }
  const submit = photoForm.querySelector('[type="submit"]'); submit.disabled = true;
  try { await api(`/api/work-orders/${selectedOrder.id}/photos`, { method: 'POST', body: new FormData(photoForm) }); closeSheet(photoSheet); await loadOrders(); }
  catch (error) { photoError.textContent = error.message; photoError.hidden = false; }
  finally { submit.disabled = false; }
});

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

document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet({ service: serviceSheet, observation: observationSheet, photo: photoSheet, finish: finishSheet, pending: pendingSheet }[button.dataset.closeSheet])));
document.querySelector('#logout-button').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.replace('/'); });

async function initialize() {
  try {
    const { user } = await api('/api/auth/me');
    if (user.role !== 'MANUTENCAO') { window.location.replace('/painel.html'); return; }
    workerGreeting.textContent = `Olá, ${user.name}`;
    teamLabel.textContent = user.teamName ? `Equipe ${user.teamName}` : 'Serviços atribuídos à sua equipe';
    await Promise.all([loadOrders(), loadNotifications()]);
  } catch { window.location.replace('/login.html?perfil=FUNCIONARIO'); }
}

initialize();
