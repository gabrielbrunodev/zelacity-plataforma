const content = document.querySelector('#dashboard-content');
const title = document.querySelector('#dashboard-title');
const description = document.querySelector('#dashboard-description');
const roleElement = document.querySelector('#dashboard-role');
const userElement = document.querySelector('#dashboard-user');
const logoutButton = document.querySelector('#logout-button');

const roleLabels = { VEREADOR: 'Vereador', MANUTENCAO: 'Manutenção', ADMINISTRADOR: 'Administrador' };
const statusLabels = { RECEBIDA: 'Recebida', EM_ANALISE: 'Em análise', ENCAMINHADA: 'Encaminhada', PENDENTE: 'Pendente', EM_ATENDIMENTO: 'Em atendimento', CONCLUIDA: 'Concluída', NAO_REALIZADA: 'Não realizada', CANCELADA: 'Cancelada' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const categoryLabels = { ESTRADAS: 'Manutenção de estrada', LAMPADAS: 'Iluminação pública', LUMINARIAS: 'Instalação de luminária', OUTROS: 'Outros' };
const sourceLabels = { MUNICIPE: 'Munícipe', '1DOC': '1Doc', ADMINISTRATIVO: 'Administração', VEREADOR: 'Vereador' };
const imageTypeLabels = { SOLICITACAO: 'Foto da solicitação', ANTES_EXECUCAO: 'Foto antes da execução', DEPOIS_EXECUCAO: 'Foto depois da execução' };
const historyTypeLabels = { SOLICITACAO_CRIADA: 'Solicitação criada', ORDEM_SERVICO_CRIADA: 'Ordem de serviço criada', STATUS_ALTERADO: 'Status alterado', ATRIBUICAO: 'Atribuição', REDISTRIBUICAO: 'Redistribuição', PRIORIDADE_ALTERADA: 'Prioridade alterada', PRAZO_ALTERADO: 'Prazo alterado', SERVICO_INICIADO: 'Serviço iniciado', SERVICO_CONCLUIDO: 'Serviço concluído', IMPOSSIBILIDADE_INFORMADA: 'Impossibilidade informada', FOTO_ADICIONADA: 'Foto adicionada', OBSERVACAO_ADICIONADA: 'Observação adicionada', ATUALIZACAO_PUBLICA: 'Atualização pública', PROTOCOLO_1DOC_VINCULADO: 'Protocolo 1Doc vinculado', SOLICITACAO_REABERTA: 'Solicitação reaberta', ATUALIZACAO: 'Atualização registrada' };
let googleMapsLoader = null;

function element(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result;
}

async function loadGoogleMaps() {
  if (window.google?.maps) return window.google.maps;
  if (googleMapsLoader) return googleMapsLoader;
  googleMapsLoader = (async () => {
    const response = await fetch('/api/config/maps');
    const mapsConfig = await response.json();
    if (!response.ok || !mapsConfig.enabled || !mapsConfig.apiKey) throw new Error('Configure a chave do Google Maps no servidor para habilitar o mapa administrativo.');
    await new Promise((resolve, reject) => {
      const callbackName = `muniAdminMapsReady${Date.now()}`;
      window[callbackName] = () => { delete window[callbackName]; resolve(); };
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsConfig.apiKey)}&v=weekly&loading=async&callback=${callbackName}&auth_referrer_policy=origin`;
      script.onerror = () => { delete window[callbackName]; reject(new Error('Não foi possível carregar o Google Maps. Verifique a chave e a conexão.')); };
      document.head.append(script);
    });
    return window.google.maps;
  })();
  try { return await googleMapsLoader; } catch (error) { googleMapsLoader = null; throw error; }
}

function mapMarkerStyle(status) {
  if (status === 'EM_ATENDIMENTO') return { color: '#2e7d63', label: 'Em atendimento' };
  if (status === 'CONCLUIDA') return { color: '#3976a8', label: 'Concluída' };
  if (['NAO_REALIZADA', 'CANCELADA'].includes(status)) return { color: '#77858b', label: statusLabels[status] || status };
  return { color: '#c98912', label: 'Pendente' };
}

function createMapInfo(request) {
  const content = element('div', 'map-info');
  content.append(element('strong', '', request.protocol));
  [['Categoria', categoryLabels[request.category] || request.category], ['Local', `${request.location} · ${request.neighborhood}`], ['Status', statusLabels[request.status] || request.status], ['Prioridade', priorityLabels[request.priority] || request.priority]].forEach(([label, value]) => {
    const line = element('p'); line.append(element('span', '', `${label}: `), document.createTextNode(value)); content.append(line);
  });
  return content;
}

function createRequestMapSection() {
  const section = element('section', 'dashboard-section admin-map-section');
  const heading = element('div', 'admin-map-heading');
  const headingIntro = element('div');
  headingIntro.append(element('p', 'eyebrow', 'Visão territorial'), element('h2', '', 'Mapa de solicitações'));
  const privacy = element('p', 'map-privacy', 'Exibe somente dados operacionais. Dados pessoais não são carregados no mapa.');
  heading.append(headingIntro, privacy);
  const filters = document.createElement('form'); filters.className = 'map-filters';
  filters.innerHTML = '<label class="field">Categoria<select name="category"><option value="">Todas</option><option value="ESTRADAS">Estradas</option><option value="LAMPADAS">Lâmpadas</option><option value="LUMINARIAS">Luminárias</option></select></label><label class="field">Status<select name="status"><option value="">Todos</option></select></label><button class="button button-secondary button-small" type="submit">Atualizar mapa</button>';
  Object.entries(statusLabels).forEach(([value, label]) => filters.elements.status.add(new Option(label, value)));
  const legend = element('div', 'map-legend'); [['Pendente', 'pending'], ['Em atendimento', 'progress'], ['Concluída', 'completed']].forEach(([label, type]) => { const item = element('span', `map-legend-item ${type}`); item.append(element('i'), document.createTextNode(label)); legend.append(item); });
  const mapElement = element('div', 'admin-request-map'); mapElement.tabIndex = 0; mapElement.setAttribute('aria-label', 'Mapa de solicitações com localização compartilhada');
  const feedback = element('p', 'map-feedback');
  section.append(heading, filters, legend, mapElement, feedback);

  let map = null;
  let infoWindow = null;
  let markers = [];
  const load = async () => {
    feedback.textContent = 'Carregando mapa e solicitações…';
    try {
      const maps = await loadGoogleMaps();
      if (!map) {
        map = new maps.Map(mapElement, { center: { lat: -14.235004, lng: -51.92528 }, zoom: 4, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
        infoWindow = new maps.InfoWindow();
      }
      const query = new URLSearchParams(Object.entries(Object.fromEntries(new FormData(filters))).filter(([, value]) => value));
      const { requests } = await api(`/api/admin/map-requests?${query}`);
      markers.forEach((marker) => marker.setMap(null)); markers = [];
      const bounds = new maps.LatLngBounds();
      requests.forEach((request) => {
        const position = { lat: Number(request.latitude), lng: Number(request.longitude) };
        if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
        const style = mapMarkerStyle(request.status);
        const marker = new maps.Marker({ map, position, title: `${request.protocol} · ${style.label}`, icon: { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: style.color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } });
        marker.addListener('click', () => { infoWindow.setContent(createMapInfo(request)); infoWindow.open({ map, anchor: marker }); });
        markers.push(marker); bounds.extend(position);
      });
      if (markers.length === 1) { map.setCenter(bounds.getCenter()); map.setZoom(15); }
      else if (markers.length > 1) map.fitBounds(bounds, 48);
      feedback.textContent = markers.length ? `${markers.length} solicitação(ões) com localização compartilhada.` : 'Nenhuma solicitação com coordenadas para os filtros selecionados.';
    } catch (error) {
      feedback.textContent = error.message;
    }
  };
  filters.addEventListener('submit', (event) => { event.preventDefault(); load(); });
  return { section, load };
}

function selectOptions(values, selected, labels, emptyLabel = '') {
  const select = document.createElement('select');
  if (emptyLabel) select.add(new Option(emptyLabel, ''));
  values.forEach((value) => select.add(new Option(labels[value] || value, value, false, value === selected)));
  return select;
}

function statusBadge(status) {
  return element('span', `status-badge status-${String(status).toLowerCase()}`, statusLabels[status] || status);
}

function deadlineBadge(request) {
  const labels = { ATRASADA: 'Atrasada', PROXIMA: 'Próxima do prazo', NO_PRAZO: 'No prazo', SEM_PRAZO: 'Sem prazo', ENCERRADA: 'Encerrada' };
  const state = request.deadline_state || 'SEM_PRAZO';
  return element('span', `deadline-badge deadline-${state.toLowerCase()}`, labels[state] || state);
}

function createImageGallery(images = []) {
  const section = element('section', 'image-gallery');
  section.append(element('h3', '', 'Imagens vinculadas'));
  if (!images.length) {
    section.append(element('p', 'gallery-empty', 'Nenhuma imagem foi enviada para esta solicitação.'));
    return section;
  }
  const grid = element('div', 'image-grid');
  images.forEach((image) => {
    const figure = element('figure', 'image-card');
    const preview = document.createElement('img');
    preview.alt = imageTypeLabels[image.image_type] || 'Imagem da solicitação';
    preview.loading = 'lazy';
    window.zelacityLoadProtectedImage(preview, `/api/images/${image.id}`).catch(() => { preview.alt = 'Imagem indisponível.'; });
    const caption = document.createElement('figcaption');
    caption.append(element('strong', '', imageTypeLabels[image.image_type] || image.image_type), element('span', '', `${image.uploaded_by_name} · ${formatDate(image.created_at, true)}`));
    if (image.work_order_number) caption.append(element('small', '', image.work_order_number));
    figure.append(preview, caption); grid.append(figure);
  });
  section.append(grid);
  return section;
}

function createHistoryTimeline(history = []) {
  const section = element('section', 'audit-timeline');
  section.append(element('h3', '', 'Histórico e auditoria'));
  if (!history.length) {
    section.append(element('p', 'gallery-empty', 'Nenhum evento registrado até o momento.'));
    return section;
  }
  const list = element('ol', 'audit-list');
  history.forEach((event) => {
    const item = element('li', 'audit-item');
    const body = element('div', 'audit-body');
    body.append(element('strong', '', event.action), element('small', 'audit-change', historyTypeLabels[event.event_type] || 'Atualização registrada'), element('span', '', `${event.user_name} · ${formatDate(event.created_at, true)}`));
    if (event.previous_status || event.new_status) body.append(element('small', 'audit-change', `${statusLabels[event.previous_status] || event.previous_status || '—'} → ${statusLabels[event.new_status] || event.new_status || '—'}`));
    if (event.previous_priority || event.new_priority) body.append(element('small', 'audit-change', `${priorityLabels[event.previous_priority] || event.previous_priority || '—'} → ${priorityLabels[event.new_priority] || event.new_priority || '—'}`));
    if (event.observation) body.append(element('p', 'audit-observation audit-observation-internal', `Observação interna: ${event.observation}`));
    if (event.public_update) body.append(element('p', 'audit-observation audit-observation-public', `Atualização pública: ${event.public_update}`));
    item.append(element('span', 'audit-dot'), body); list.append(item);
  });
  section.append(list);
  return section;
}

function createMetric(label, value, accent = '') {
  const card = element('article', `metric-card ${accent}`);
  card.append(element('span', '', label), element('strong', '', String(value || 0)));
  return card;
}

function createFilters(categories, teams, maintenanceUsers, onSubmit) {
  const form = document.createElement('form');
  form.className = 'dashboard-filters';
  form.innerHTML = '<label class="field">Categoria<select name="category"><option value="">Todas</option></select></label><label class="field">Origem<select name="source"><option value="">Todas</option><option value="MUNICIPE">Munícipe</option><option value="VEREADOR">Vereador</option><option value="1DOC">1Doc</option><option value="ADMINISTRATIVO">Administração</option></select></label><label class="field">Status<select name="status"><option value="">Todos</option></select></label><label class="field">Prioridade<select name="priority"><option value="">Todas</option></select></label><label class="field">Equipe<select name="teamId"><option value="">Todas</option></select></label><label class="field">Funcionário<select name="employeeId"><option value="">Todos</option></select></label><label class="field">De<input name="startDate" type="date" /></label><label class="field">Até<input name="endDate" type="date" /></label><label class="field">Bairro<input name="neighborhood" type="text" placeholder="Ex.: Centro" /></label><label class="field">Protocolo do aplicativo ou 1Doc<input name="protocol" type="search" placeholder="2026-00154 ou 1234/2026" /></label><button class="button button-primary button-small" type="submit">Filtrar</button><button class="button button-secondary button-small" type="reset">Limpar</button>';
  categories.forEach((category) => form.elements.category.add(new Option(category.name, category.code)));
  const statusSelect = form.elements.status; Object.entries(statusLabels).forEach(([value, label]) => statusSelect.add(new Option(label, value)));
  Object.entries(priorityLabels).forEach(([value, label]) => form.elements.priority.add(new Option(label, value)));
  teams.forEach((team) => form.elements.teamId.add(new Option(team.name, team.id)));
  maintenanceUsers.forEach((user) => form.elements.employeeId.add(new Option(user.name, user.id)));
  form.addEventListener('submit', (event) => { event.preventDefault(); onSubmit(Object.fromEntries(new FormData(form))); });
  form.addEventListener('reset', () => window.setTimeout(() => onSubmit({}), 0));
  return form;
}

function openDetails(request, teams, maintenanceUsers, onUpdate) {
  const overlay = element('div', 'detail-overlay');
  const dialog = element('section', 'request-detail-dialog');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', `Solicitação ${request.protocol}`);
  const header = element('div', 'dialog-header');
  const heading = element('div'); heading.append(element('p', 'eyebrow', 'Detalhes da solicitação'), element('h2', '', request.protocol));
  const close = element('button', 'dialog-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Fechar detalhes');
  close.addEventListener('click', () => overlay.remove()); header.append(heading, close);
  const data = element('dl', 'detail-list');
  const specific = (() => { try { return JSON.parse(request.specific_details || '{}'); } catch { return {}; } })();
  const fields = [
    ['Solicitante', request.requester_name], ['Origem', sourceLabels[request.source] || request.source || (request.requester_type === 'VEREADOR' ? 'Vereador' : 'Aplicativo')], ['Protocolo 1Doc', request.external_protocol || 'Não vinculado'], ['Telefone', request.phone], ['E-mail', request.requester_email || 'Não informado'],
    ['Categoria', categoryLabels[request.category] || request.category], ['Local', request.location], ['Localização GPS', request.latitude !== null && request.longitude !== null ? `${Number(request.latitude).toFixed(6)}, ${Number(request.longitude).toFixed(6)}` : 'Não compartilhada'], ['Bairro', request.neighborhood],
    ['Ponto de referência', request.reference], ['Descrição', request.description], ['Informação complementar', Object.values(specific).join(' · ') || '—'],
    ['Responsável', request.responsible_name || 'Não atribuído'], ['Data de recebimento no 1Doc', request.received_at ? formatDate(request.received_at) : '—'], ['Aberta em', formatDate(request.created_at, true)], ['Prazo', request.deadline_at ? formatDate(request.deadline_at) : 'Não definido'], ['Dias em aberto', `${request.open_days ?? 0} dia(s)`], ['Última atualização', formatDate(request.updated_at, true)],
  ];
  fields.forEach(([label, value]) => { const item = element('div'); item.append(element('dt', '', label), element('dd', '', value || '—')); data.append(item); });
  if (request.latitude !== null && request.longitude !== null) {
    const locationLink = document.createElement('a');
    locationLink.className = 'map-link';
    locationLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${request.latitude},${request.longitude}`)}`;
    locationLink.target = '_blank';
    locationLink.rel = 'noopener noreferrer';
    locationLink.textContent = 'Abrir localização no Google Maps ↗';
    const mapItem = element('div'); mapItem.append(element('dt', '', 'Mapa'), locationLink); data.append(mapItem);
  }
  const actions = element('section', 'detail-management'); actions.append(element('h3', '', 'Gestão administrativa'));
  const status = selectOptions(Object.keys(statusLabels), request.status, statusLabels);
  const statusField = element('label', 'field', 'Novo status'); statusField.append(status);
  const priority = selectOptions(Object.keys(priorityLabels), request.priority, priorityLabels);
  const priorityField = element('label', 'field', 'Prioridade'); priorityField.append(priority);
  const deadline = document.createElement('input'); deadline.type = 'date'; deadline.value = request.deadline_at ? request.deadline_at.slice(0, 10) : ''; deadline.setAttribute('aria-label', 'Prazo da solicitação');
  const deadlineField = element('label', 'field', 'Prazo'); deadlineField.append(deadline);
  const externalProtocol = document.createElement('input'); externalProtocol.type = 'text'; externalProtocol.value = request.external_protocol || ''; externalProtocol.placeholder = 'Protocolo do 1Doc (opcional)'; externalProtocol.setAttribute('aria-label', 'Protocolo do 1Doc');
  const internalObservation = document.createElement('textarea'); internalObservation.rows = 3; internalObservation.maxLength = 2000; internalObservation.placeholder = 'Visível somente para usuários autorizados.';
  const internalObservationField = element('label', 'field field-wide', 'Observação interna'); internalObservationField.append(internalObservation);
  const publicUpdate = document.createElement('textarea'); publicUpdate.rows = 3; publicUpdate.maxLength = 1000; publicUpdate.placeholder = 'Texto que poderá ser exibido na consulta por protocolo.';
  const publicUpdateField = element('label', 'field field-wide', 'Atualização pública'); publicUpdateField.append(publicUpdate);
  const administrativeMessage = document.createElement('textarea'); administrativeMessage.rows = 3; administrativeMessage.maxLength = 1000; administrativeMessage.placeholder = request.work_order_number ? 'Mensagem para a equipe responsável.' : 'Crie e atribua uma ordem de serviço antes de enviar mensagem.'; administrativeMessage.disabled = !request.work_order_number;
  const administrativeMessageField = element('label', 'field field-wide', 'Mensagem administrativa para a equipe'); administrativeMessageField.append(administrativeMessage);
  const externalProtocolField = element('label', 'field', 'Protocolo do 1Doc'); externalProtocolField.append(externalProtocol);
  const save = element('button', 'button button-secondary button-small', 'Salvar atualização');
  const sendAdministrativeMessage = element('button', 'button button-secondary button-small', 'Enviar mensagem à equipe'); sendAdministrativeMessage.type = 'button'; sendAdministrativeMessage.disabled = !request.work_order_number;
  const team = document.createElement('select'); team.add(new Option('Selecionar equipe', '')); teams.forEach((item) => team.add(new Option(item.name, item.id)));
  const assignee = document.createElement('select');
  const refreshAssignees = () => { assignee.replaceChildren(new Option('Selecionar responsável', '')); maintenanceUsers.filter((user) => { if (String(user.team_id) !== team.value) return false; try { const categories = JSON.parse(user.service_categories || '[]'); return !categories.length || categories.includes(request.category); } catch { return true; } }).forEach((user) => assignee.add(new Option(user.name, user.id))); };
  team.addEventListener('change', refreshAssignees);
  const schedule = document.createElement('input'); schedule.type = 'datetime-local'; schedule.setAttribute('aria-label', 'Data programada');
  const assign = element('button', 'button button-primary button-small', 'Atribuir para equipe ou funcionário');
  const feedback = element('p', 'inline-feedback');
  save.addEventListener('click', async () => { try { await api(`/api/requests/${encodeURIComponent(request.protocol)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status.value, priority: priority.value, deadlineAt: deadline.value, externalProtocol: externalProtocol.value, internalObservation: internalObservation.value, publicUpdate: publicUpdate.value }) }); feedback.textContent = 'Solicitação atualizada e registrada no histórico.'; onUpdate(); } catch (error) { feedback.textContent = error.message; } });
  sendAdministrativeMessage.addEventListener('click', async () => { try { if (!administrativeMessage.value.trim()) throw new Error('Escreva a mensagem para a equipe.'); await api(`/api/work-orders/${encodeURIComponent(request.work_order_number)}/notifications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: administrativeMessage.value }) }); administrativeMessage.value = ''; feedback.textContent = 'Mensagem enviada para a central interna da equipe.'; } catch (error) { feedback.textContent = error.message; } });
  assign.addEventListener('click', async () => { try { if (!team.value || !schedule.value) throw new Error('Informe equipe e data programada. O funcionário é opcional.'); await api(`/api/requests/${encodeURIComponent(request.protocol)}/work-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId: team.value, assignedUserId: assignee.value || null, scheduledAt: schedule.value }) }); feedback.textContent = assignee.value ? 'Ordem atribuída ao funcionário selecionado.' : 'Ordem atribuída à equipe; todos os integrantes ativos poderão visualizá-la.'; onUpdate(); } catch (error) { feedback.textContent = error.message; } });
  actions.append(statusField, priorityField, deadlineField, externalProtocolField, internalObservationField, publicUpdateField, administrativeMessageField, save, sendAdministrativeMessage, team, assignee, schedule, assign, feedback);
  dialog.append(header, data, createImageGallery(request.images), createHistoryTimeline(request.history), actions); overlay.append(dialog); document.body.append(overlay);
}

function renderTable(requests, teams, maintenanceUsers, reload) {
  const container = element('div', 'request-table-wrap');
  const table = element('table', 'request-table');
  const head = document.createElement('thead'); const row = document.createElement('tr');
  ['Protocolo', 'Abertura', 'Origem', 'Categoria', 'Local', 'Solicitante', 'Prioridade', 'Prazo', 'Dias em aberto', 'Status', 'Responsável'].forEach((name) => row.append(element('th', '', name))); head.append(row);
  const body = document.createElement('tbody');
  if (!requests.length) { const empty = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 11; cell.textContent = 'Nenhuma solicitação encontrada com estes filtros.'; empty.append(cell); body.append(empty); }
  requests.forEach((request) => {
    const row = document.createElement('tr');
    const protocolCell = document.createElement('td'); const button = element('button', 'protocol-link', request.protocol); button.type = 'button';
    button.addEventListener('click', async () => { try { const result = await api(`/api/requests/${encodeURIComponent(request.protocol)}`); openDetails(result.request, teams, maintenanceUsers, reload); } catch (error) { window.alert(error.message); } });
    protocolCell.append(button); row.append(protocolCell);
    const requester = element('td', '', request.requester_name);
    if (request.requester_type === 'VEREADOR') requester.append(document.createElement('br'), element('small', 'request-origin-label', 'Origem: Vereador'));
    const deadlineCell = element('td'); deadlineCell.append(element('span', '', request.deadline_at ? formatDate(request.deadline_at) : '—'), document.createElement('br'), deadlineBadge(request));
    row.append(element('td', '', formatDate(request.created_at)), element('td', '', sourceLabels[request.source] || request.source || 'Munícipe'), element('td', '', categoryLabels[request.category] || request.category), element('td', '', `${request.location} · ${request.neighborhood}`), requester, element('td', '', priorityLabels[request.priority] || request.priority), deadlineCell, element('td', '', `${request.open_days ?? 0} dia(s)`));
    const statusCell = document.createElement('td'); statusCell.append(statusBadge(request.status)); row.append(statusCell); row.append(element('td', '', request.responsible_name || 'Não atribuído')); body.append(row);
  });
  table.append(head, body); labelTableForMobile(table); container.append(table); return container;
}

function labelTableForMobile(table) {
  const labels = Array.from(table.querySelectorAll('thead th'), (cell) => cell.textContent.trim());
  table.querySelectorAll('tbody tr').forEach((row) => {
    Array.from(row.cells).forEach((cell, index) => { cell.dataset.label = labels[index] || ''; });
  });
}

function categoriesForUser(user) {
  try { return Array.isArray(user.service_categories) ? user.service_categories : JSON.parse(user.service_categories || '[]'); } catch { return []; }
}

function addTeamOptions(select, teams, selected = '') {
  select.replaceChildren(new Option('Sem equipe', ''));
  teams.forEach((team) => select.add(new Option(team.name, team.id, false, String(team.id) === String(selected))));
}

function payloadFromEmployeeForm(form) {
  const data = Object.fromEntries(new FormData(form));
  data.serviceCategories = [...form.querySelectorAll('[name="serviceCategories"]:checked')].map((input) => input.value);
  return data;
}

function syncInternalProfileForm(form) {
  const isMaintenance = form.elements.role.value === 'MANUTENCAO';
  ['phone', 'jobTitle', 'department'].forEach((name) => { form.elements[name].required = isMaintenance; });
  form.querySelectorAll('[data-maintenance-only]').forEach((field) => { field.hidden = !isMaintenance; });
  if (!isMaintenance) {
    form.elements.teamId.value = '';
    form.querySelectorAll('[name="serviceCategories"]').forEach((input) => { input.checked = false; });
  }
}

function createEmployeeForm(teams, availableCategories, initial = {}) {
  const form = document.createElement('form'); form.className = 'user-form';
  form.innerHTML = '<label class="field">Nome *<input name="name" required /></label><label class="field">Usuário *<input name="username" autocomplete="username" pattern="[A-Za-z0-9._-]{3,60}" required /></label><label class="field">Matrícula/identificação <small>opcional</small><input name="employeeNumber" /></label><label class="field" data-maintenance-only>Telefone *<input name="phone" type="tel" /></label><label class="field" data-maintenance-only>Função *<input name="jobTitle" placeholder="Ex.: Eletricista" /></label><label class="field" data-maintenance-only>Setor *<input name="department" placeholder="Ex.: Iluminação pública" /></label><label class="field">Perfil<select name="role"><option value="VEREADOR">Vereador</option><option value="MANUTENCAO">Manutenção</option><option value="ADMINISTRADOR">Administrador</option></select></label><label class="field" data-maintenance-only>Equipe<select name="teamId"></select></label><fieldset class="service-category-field" data-maintenance-only><legend>Serviços sob responsabilidade</legend><label><input type="checkbox" name="serviceCategories" value="ESTRADAS" /> Estradas</label><label><input type="checkbox" name="serviceCategories" value="LAMPADAS" /> Iluminação</label><label><input type="checkbox" name="serviceCategories" value="LUMINARIAS" /> Luminárias</label></fieldset>';
  const categoryFieldset = form.querySelector('.service-category-field'); categoryFieldset.replaceChildren(element('legend', '', 'Serviços sob responsabilidade'));
  availableCategories.forEach((category) => { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'serviceCategories'; input.value = category.code; label.append(input, ` ${category.name}`); categoryFieldset.append(label); });
  addTeamOptions(form.elements.teamId, teams, initial.team_id || initial.teamId || '');
  ['name', 'username', 'employeeNumber', 'phone', 'jobTitle', 'department'].forEach((name) => { if (initial[name] ?? initial[{ employeeNumber: 'employee_number', jobTitle: 'job_title' }[name]]) form.elements[name].value = initial[name] ?? initial[{ employeeNumber: 'employee_number', jobTitle: 'job_title' }[name]]; });
  form.elements.role.value = initial.role || 'MANUTENCAO';
  const categories = categoriesForUser(initial); form.querySelectorAll('[name="serviceCategories"]').forEach((input) => { input.checked = categories.includes(input.value); });
  form.elements.role.addEventListener('change', () => syncInternalProfileForm(form));
  syncInternalProfileForm(form);
  return form;
}

function renderUserManagement(users, teams, categories, reload) {
  const section = element('section', 'dashboard-section user-management');
  section.append(element('p', 'eyebrow', 'Acesso interno'), element('h2', '', 'Funcionários e equipes'), element('p', 'dashboard-notice', 'Somente administradores gerenciam acessos. Funcionários não podem conceder permissões administrativas a si próprios. As senhas são protegidas e nunca são exibidas; use “Editar” para redefinir uma senha.'));
  const teamForm = document.createElement('form'); teamForm.className = 'team-form';
  teamForm.innerHTML = '<label class="field">Nova equipe<input name="name" minlength="3" placeholder="Ex.: Equipe de Iluminação" required /></label><button class="button button-secondary button-small" type="submit">Criar equipe</button>';
  const teamFeedback = element('p', 'inline-feedback'); teamForm.append(teamFeedback);
  teamForm.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(teamForm))) }); teamFeedback.textContent = 'Equipe criada com sucesso.'; reload(); } catch (error) { teamFeedback.textContent = error.message; } });
  section.append(teamForm, element('h3', '', 'Cadastrar acesso interno'));
  const form = createEmployeeForm(teams, categories);
  const password = document.createElement('label'); password.className = 'field'; password.innerHTML = 'Senha inicial *<input name="password" type="password" minlength="8" required />'; form.append(password);
  const submit = element('button', 'button button-primary button-small', 'Cadastrar usuário'); submit.type = 'submit'; form.append(submit);
  const feedback = element('p', 'inline-feedback'); form.append(feedback);
  form.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFromEmployeeForm(form)) }); feedback.textContent = 'Usuário cadastrado com sucesso.'; reload(); } catch (error) { feedback.textContent = error.message; } });
  const userList = element('div', 'user-list'); userList.append(element('h3', '', 'Acessos internos'));
  users.forEach((user) => {
    const card = element('article', `user-list-card${user.active ? '' : ' is-inactive'}`);
    const summary = element('div', 'user-list-summary');
    const text = element('div'); text.append(element('strong', '', user.name), element('p', '', `${roleLabels[user.role] || user.role} · ${user.job_title || 'Função não informada'}${user.team_name ? ` · ${user.team_name}` : ''}`));
    if (user.role === 'MANUTENCAO') {
      const categoryNames = categoriesForUser(user).map((code) => categories.find((category) => category.code === code)?.name || code);
      text.append(element('small', 'user-service-categories', `Serviços de manutenção: ${categoryNames.length ? categoryNames.join(', ') : 'nenhum serviço definido'}`));
    }
    text.append(element('small', '', user.active ? 'Acesso ativo' : 'Acesso desativado'));
    const edit = element('button', 'button button-secondary button-small', 'Editar'); edit.type = 'button'; summary.append(text, edit); card.append(summary);
    const editor = createEmployeeForm(teams, categories, user); editor.hidden = true;
    const active = document.createElement('label'); active.className = 'field'; active.innerHTML = '<span>Status do acesso</span><select name="active"><option value="true">Ativo</option><option value="false">Inativo</option></select>'; active.querySelector('select').value = user.active ? 'true' : 'false'; editor.append(active);
    const reset = document.createElement('label'); reset.className = 'field'; reset.innerHTML = 'Nova senha <small>opcional</small><input name="password" type="password" minlength="8" />'; editor.append(reset);
    const save = element('button', 'button button-primary button-small', 'Salvar alterações'); save.type = 'submit'; editor.append(save);
    const editorFeedback = element('p', 'inline-feedback'); editor.append(editorFeedback); card.append(editor);
    edit.addEventListener('click', () => { editor.hidden = !editor.hidden; edit.textContent = editor.hidden ? 'Editar' : 'Fechar'; });
    editor.addEventListener('submit', async (event) => { event.preventDefault(); try { await api(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFromEmployeeForm(editor)) }); editorFeedback.textContent = 'Dados atualizados.'; reload(); } catch (error) { editorFeedback.textContent = error.message; } });
    userList.append(card);
  });
  section.append(teamForm, form, userList); return section;
}

function renderInternalRequestRegistration(categories, reload, source) {
  const isOneDoc = source === '1DOC';
  const section = element('section', 'dashboard-section');
  section.append(
    element('p', 'eyebrow', 'Cadastro administrativo'),
    element('h2', '', isOneDoc ? 'Nova solicitação do 1Doc' : 'Nova solicitação administrativa'),
    element('p', 'dashboard-notice', isOneDoc ? 'Registre manualmente uma demanda recebida pelo 1Doc. O protocolo do 1Doc permanece vinculado ao protocolo gerado pelo aplicativo.' : 'Registre uma solicitação criada diretamente pela Administração. A origem será registrada automaticamente como Administração.'),
  );
  const form = document.createElement('form'); form.className = 'user-form';
  form.innerHTML = `<input name="source" type="hidden" value="${source}" />${isOneDoc ? '<label class="field">Número/protocolo do 1Doc *<input name="externalProtocol" maxlength="120" placeholder="Ex.: 1234/2026" required /></label><label class="field">Data de recebimento *<input name="receivedAt" type="date" required /></label>' : ''}<label class="field">Nome do solicitante *<input name="name" required /></label><label class="field">Telefone ${isOneDoc ? '<small>opcional</small>' : '*'}<input name="phone" type="tel" ${isOneDoc ? '' : 'required'} /></label><label class="field">E-mail <small>opcional</small><input name="email" type="email" /></label><label class="field">Categoria *<select name="serviceType" required><option value="ESTRADAS">Manutenção de estradas</option><option value="LAMPADAS">Troca de lâmpadas</option><option value="LUMINARIAS">Instalação de luminárias</option></select></label><label class="field">Prioridade *<select name="priority"><option value="BAIXA">Baixa</option><option value="NORMAL" selected>Normal</option><option value="ALTA">Alta</option><option value="URGENTE">Urgente</option></select></label><label class="field">Prazo <small>opcional; substitui o prazo padrão da categoria</small><input name="deadlineAt" type="date" /></label><label class="field field-wide">Endereço/local *<input name="location" required /></label><label class="field">Bairro *<input name="neighborhood" required /></label><label class="field">Referência <small>opcional</small><input name="reference" /></label><label class="field field-wide">Descrição *<textarea name="description" rows="3" required></textarea></label><label class="field field-wide">Foto ou anexo de imagem <small>opcional: JPG, PNG ou WEBP, até 5 MB</small><input name="requestPhoto" type="file" accept="image/jpeg,image/png,image/webp" /></label><label class="field field-wide">Observações internas <small>não aparecem na consulta pública</small><textarea name="internalObservation" rows="3" maxlength="2000"></textarea></label>`;
  const categorySelect = form.elements.serviceType; categorySelect.replaceChildren(); categories.filter((category) => category.active).forEach((category) => categorySelect.add(new Option(category.name, category.code)));
  const submit = element('button', 'button button-primary button-small', isOneDoc ? 'Registrar solicitação do 1Doc' : 'Registrar solicitação administrativa'); submit.type = 'submit';
  const feedback = element('p', 'inline-feedback'); form.append(submit, feedback);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/admin/requests', { method: 'POST', body: new FormData(form) });
      feedback.textContent = isOneDoc ? `Solicitação registrada. Protocolo do aplicativo: ${result.protocol}. Protocolo 1Doc vinculado: ${form.elements.externalProtocol.value}.` : `Solicitação registrada. Protocolo do aplicativo: ${result.protocol}. Origem: Administração.`; form.reset(); reload();
    } catch (error) { feedback.textContent = error.message; }
  });
  section.append(form); return section;
}

function renderCategoryManagement(categories, reload) {
  const section = element('section', 'dashboard-section');
  section.append(element('p', 'eyebrow', 'Configuração'), element('h2', '', 'Categorias de serviço'), element('p', 'dashboard-notice', 'Cadastre novas categorias ou altere nome e disponibilidade sem afetar solicitações já registradas.'));
  const createForm = document.createElement('form'); createForm.className = 'team-form'; createForm.innerHTML = '<label class="field">Nova categoria<input name="name" minlength="3" placeholder="Ex.: Limpeza urbana" required /></label><label class="field">Prazo padrão <small>em dias; opcional</small><input name="defaultDeadlineDays" type="number" min="1" max="3650" /></label><button class="button button-secondary button-small" type="submit">Adicionar categoria</button>';
  const createFeedback = element('p', 'inline-feedback'); createForm.append(createFeedback);
  createForm.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/admin/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(createForm))) }); createFeedback.textContent = 'Categoria cadastrada.'; reload(); } catch (error) { createFeedback.textContent = error.message; } });
  section.append(createForm);
  categories.forEach((category) => {
    const form = document.createElement('form'); form.className = 'team-form';
    const code = element('strong', 'protocol-text', category.code);
    const name = document.createElement('label'); name.className = 'field'; name.innerHTML = 'Nome exibido<input name="name" required />'; name.querySelector('input').value = category.name;
    const active = document.createElement('label'); active.className = 'field'; active.innerHTML = '<span>Disponível para novos registros</span><select name="active"><option value="true">Sim</option><option value="false">Não</option></select>'; active.querySelector('select').value = category.active ? 'true' : 'false';
    const defaultDeadline = document.createElement('label'); defaultDeadline.className = 'field'; defaultDeadline.innerHTML = 'Prazo padrão <small>em dias; opcional</small><input name="defaultDeadlineDays" type="number" min="1" max="3650" />'; defaultDeadline.querySelector('input').value = category.default_deadline_days || '';
    const save = element('button', 'button button-secondary button-small', 'Salvar'); save.type = 'submit'; const feedback = element('p', 'inline-feedback');
    form.append(code, name, active, defaultDeadline, save, feedback);
    form.addEventListener('submit', async (event) => { event.preventDefault(); try { await api(`/api/admin/categories/${category.code}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); feedback.textContent = 'Categoria atualizada.'; reload(); } catch (error) { feedback.textContent = error.message; } });
    section.append(form);
  });
  return section;
}

function renderDemoAccess(demo) {
  if (!demo?.enabled) return null;
  const section = element('section', 'demo-access-card');
  section.append(element('p', 'eyebrow', 'Demonstração'), element('h2', '', 'Acesso para apresentar o sistema'), element('p', 'demo-access-copy', 'Estas credenciais são somente para demonstração. Não use esta conta em produção nem para dados reais.'));
  const credentials = element('div', 'demo-credentials');
  [['Usuário', demo.username], ['Senha', demo.password]].forEach(([label, value]) => {
    const item = element('div', 'demo-credential'); item.append(element('span', '', label), element('code', '', value || '—')); credentials.append(item);
  });
  section.append(credentials); return section;
}

async function renderAdministrator() {
  title.textContent = 'Painel administrativo';
  description.textContent = 'Visão consolidada para priorizar, analisar e encaminhar as solicitações municipais.';
  const [teamsResult, usersResult, categoriesResult, demoResult] = await Promise.all([api('/api/teams'), api('/api/users'), api('/api/admin/categories'), api('/api/config/demo')]);
  categoriesResult.categories.forEach((category) => { categoryLabels[category.code] = category.name; });
  const teams = teamsResult.teams;
  const maintenanceUsers = usersResult.users.filter((user) => user.role === 'MANUTENCAO' && user.active);
  content.replaceChildren();
  const requestMap = createRequestMapSection();
  const filtersSection = element('section', 'dashboard-section filters-section'); filtersSection.id = 'solicitacoes'; filtersSection.append(element('h2', '', 'Solicitações')); const tableHost = element('div');
  const loadDashboard = async (filters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    const dashboard = await api(`/api/admin/dashboard?${query}`);
    const statistics = dashboard.statistics;
    const metrics = element('div', 'metrics-grid');
    metrics.append(createMetric('Total de solicitações', statistics.total, 'metric-total'), createMetric('Recebidas', statistics.received, 'metric-awaiting'), createMetric('Pendentes', statistics.pending, 'metric-scheduled'), createMetric('Em atendimento', statistics.in_progress, 'metric-progress'), createMetric('Concluídas', statistics.completed, 'metric-completed'), createMetric('Atrasadas', statistics.overdue, 'metric-rejected'));
    const breakdowns = element('div', 'dashboard-breakdowns');
    const summary = (title, rows, labels) => { const box = element('section', 'dashboard-breakdown'); box.append(element('h3', '', title)); rows.forEach((row) => { const line = element('p', 'breakdown-line'); line.append(element('span', '', labels[row.key] || row.key || 'Não informado'), element('strong', '', row.total)); box.append(line); }); return box; };
    breakdowns.append(summary('Solicitações por categoria', statistics.byCategory, categoryLabels), summary('Solicitações por origem', statistics.bySource, sourceLabels));
    tableHost.replaceChildren(metrics, breakdowns, renderTable(dashboard.requests, teams, maintenanceUsers, () => loadDashboard(filters)));
  };
  const manual = renderInternalRequestRegistration(categoriesResult.categories, renderAdministrator, '1DOC'); manual.id = 'nova-solicitacao';
  const administrativeManual = renderInternalRequestRegistration(categoriesResult.categories, renderAdministrator, 'ADMINISTRATIVO'); administrativeManual.id = 'nova-solicitacao-administrativa';
  const users = renderUserManagement(usersResult.users, teams, categoriesResult.categories, renderAdministrator); users.id = 'funcionarios';
  const categories = renderCategoryManagement(categoriesResult.categories, renderAdministrator); categories.id = 'categorias'; categories.querySelector('h2').textContent = 'Categorias e configurações';
  filtersSection.append(createFilters(categoriesResult.categories, teams, maintenanceUsers, loadDashboard), tableHost);
  const sections = [requestMap.section, filtersSection, manual, administrativeManual, users, categories]; const demoAccess = renderDemoAccess(demoResult); if (demoAccess) sections.unshift(demoAccess); content.append(...sections); await Promise.all([requestMap.load(), loadDashboard()]);
}

async function renderMaintenance(user) {
  const { workOrders } = await api('/api/work-orders'); title.textContent = 'Ordens da equipe'; description.textContent = user.teamName ? `Demandas atribuídas à equipe ${user.teamName}.` : 'Demandas atribuídas à sua equipe.'; content.replaceChildren();
  const section = element('section', 'dashboard-section'); const mobileLink = element('a', 'button button-primary button-small', 'Abrir área mobile da equipe'); mobileLink.href = '/manutencao.html'; section.append(element('h2', '', 'Ordens de serviço atribuídas'), mobileLink);
  if (!workOrders.length) section.append(element('p', 'dashboard-notice', 'Nenhuma ordem de serviço está atribuída à sua equipe.'));
  workOrders.forEach((order) => { const card = element('article', 'management-card'); card.append(element('strong', 'protocol-text', order.number), element('p', '', `${categoryLabels[order.category] || order.category} · ${order.location}`), element('p', 'muted-text', order.description)); const form = document.createElement('form'); form.className = 'work-update-form'; form.innerHTML = '<select name="type"><option value="INICIO">Iniciar serviço</option><option value="OBSERVACAO">Adicionar observação</option></select><input name="description" placeholder="Descreva a atualização" required /><button class="button button-primary button-small" type="submit">Registrar</button>'; const feedback = element('p', 'inline-feedback'); form.append(feedback); form.addEventListener('submit', async (event) => { event.preventDefault(); try { await api(`/api/work-orders/${order.id}/updates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); feedback.textContent = 'Atualização registrada.'; form.reset(); } catch (error) { feedback.textContent = error.message; } }); card.append(form); section.append(card); }); content.append(section);
}

function renderRequester() {
  title.textContent = 'Área do solicitante'; description.textContent = 'Registre novas necessidades e acompanhe, com segurança, o andamento dos seus protocolos.'; const actions = element('div', 'requester-actions'); const requestLink = element('a', 'action-card', 'Registrar nova solicitação'); requestLink.href = '/#nova-solicitacao'; const trackingLink = element('a', 'action-card', 'Consultar protocolo'); trackingLink.href = '/acompanhar.html'; actions.append(requestLink, trackingLink); content.replaceChildren(actions);
}

async function renderCouncilMember(user) {
  const { requests } = await api('/api/vereador/requests');
  title.textContent = 'Área do vereador';
  description.textContent = 'Registre demandas, acompanhe os protocolos originados pelo seu gabinete e consulte o andamento sem acesso a ações administrativas.';
  const actions = element('div', 'requester-actions');
  const requestLink = element('a', 'action-card', 'Criar nova solicitação'); requestLink.href = '/#nova-solicitacao';
  const trackingLink = element('a', 'action-card', 'Acompanhar por protocolo'); trackingLink.href = '/acompanhar.html';
  actions.append(requestLink, trackingLink);
  const section = element('section', 'dashboard-section'); section.append(element('p', 'eyebrow', 'Protocolos do gabinete'), element('h2', '', 'Minhas solicitações'));
  if (!requests.length) {
    section.append(element('p', 'dashboard-notice', 'Você ainda não criou nenhuma solicitação.'));
  } else {
    const wrap = element('div', 'request-table-wrap'); const table = element('table', 'request-table council-request-table');
    const head = document.createElement('thead'); const row = document.createElement('tr');
    ['Protocolo', 'Data', 'Serviço', 'Local', 'Prioridade', 'Status', 'Última atualização', 'Histórico'].forEach((label) => row.append(element('th', '', label))); head.append(row);
    const body = document.createElement('tbody');
    requests.forEach((request) => {
      const row = document.createElement('tr');
      row.append(element('td', 'protocol-text', request.protocol), element('td', '', formatDate(request.created_at)), element('td', '', categoryLabels[request.category] || request.category), element('td', '', `${request.location} · ${request.neighborhood}`), element('td', '', priorityLabels[request.priority] || request.priority));
      const status = document.createElement('td'); status.append(statusBadge(request.status));
      const historyLink = element('a', 'button button-secondary button-small', 'Consultar'); historyLink.href = `/acompanhar.html?protocol=${encodeURIComponent(request.protocol)}`;
      row.append(status, element('td', '', formatDate(request.updated_at, true)), historyLink); body.append(row);
    });
    table.append(head, body); labelTableForMobile(table); wrap.append(table); section.append(wrap);
  }
  content.replaceChildren(actions, section);
}

async function initialize() {
  try {
    const { user } = await api('/api/auth/me'); userElement.textContent = `${roleLabels[user.role]} · ${user.name}`; roleElement.textContent = roleLabels[user.role];
    document.querySelectorAll('[data-admin-nav]').forEach((link) => { link.hidden = user.role !== 'ADMINISTRADOR'; });
    if (user.role === 'ADMINISTRADOR') await renderAdministrator(); else if (user.role === 'MANUTENCAO') await renderMaintenance(user); else if (user.role === 'VEREADOR') await renderCouncilMember(user); else renderRequester();
  } catch { window.location.replace('/login.html'); }
}

logoutButton.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.replace('/'); });
initialize();
