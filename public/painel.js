const content = document.querySelector('#dashboard-content');
const title = document.querySelector('#dashboard-title');
const description = document.querySelector('#dashboard-description');
const roleElement = document.querySelector('#dashboard-role');
const userElement = document.querySelector('#dashboard-user');
const logoutButton = document.querySelector('#logout-button');

const roleLabels = { VEREADOR: 'Vereador', MANUTENCAO: 'Manutenção', ADMINISTRADOR: 'Administrador' };
const statusLabels = { RECEBIDA: 'Solicitação recebida', AGUARDANDO_ANALISE: 'Aguardando análise', EM_ANALISE: 'Em análise', INFORMACOES_ADICIONAIS: 'Informações adicionais solicitadas', APROVADA: 'Aprovada', PROGRAMADA: 'Programada', EM_EXECUCAO: 'Em execução', CONCLUIDA: 'Concluída', INDEFERIDA: 'Indeferida', CANCELADA: 'Cancelada' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const categoryLabels = { ESTRADAS: 'Manutenção de estradas', LAMPADAS: 'Troca de lâmpadas', LUMINARIAS: 'Instalação de luminárias' };
const imageTypeLabels = { SOLICITACAO: 'Foto da solicitação', ANTES_EXECUCAO: 'Foto antes da execução', DEPOIS_EXECUCAO: 'Foto depois da execução' };
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
  if (status === 'EM_EXECUCAO') return { color: '#2e7d63', label: 'Em execução' };
  if (status === 'CONCLUIDA') return { color: '#3976a8', label: 'Concluída' };
  if (['INDEFERIDA', 'CANCELADA'].includes(status)) return { color: '#77858b', label: statusLabels[status] || status };
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
  const legend = element('div', 'map-legend'); [['Pendente', 'pending'], ['Em execução', 'progress'], ['Concluída', 'completed']].forEach(([label, type]) => { const item = element('span', `map-legend-item ${type}`); item.append(element('i'), document.createTextNode(label)); legend.append(item); });
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
    preview.src = `/api/images/${image.id}`;
    preview.alt = imageTypeLabels[image.image_type] || 'Imagem da solicitação';
    preview.loading = 'lazy';
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
    body.append(element('strong', '', event.action), element('span', '', `${event.user_name} · ${formatDate(event.created_at, true)}`));
    if (event.previous_status || event.new_status) body.append(element('small', 'audit-change', `${statusLabels[event.previous_status] || event.previous_status || '—'} → ${statusLabels[event.new_status] || event.new_status || '—'}`));
    if (event.previous_priority || event.new_priority) body.append(element('small', 'audit-change', `${priorityLabels[event.previous_priority] || event.previous_priority || '—'} → ${priorityLabels[event.new_priority] || event.new_priority || '—'}`));
    if (event.observation) body.append(element('p', '', event.observation));
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

function createFilters(onSubmit) {
  const form = document.createElement('form');
  form.className = 'dashboard-filters';
  form.innerHTML = '<label class="field">Categoria<select name="category"><option value="">Todas</option><option value="ESTRADAS">Estradas</option><option value="LAMPADAS">Lâmpadas</option><option value="LUMINARIAS">Luminárias</option></select></label><label class="field">Status<select name="status"><option value="">Todos</option></select></label><label class="field">Prioridade<select name="priority"><option value="">Todas</option></select></label><label class="field">De<input name="startDate" type="date" /></label><label class="field">Até<input name="endDate" type="date" /></label><label class="field">Bairro<input name="neighborhood" type="text" placeholder="Ex.: Centro" /></label><label class="field">Protocolo<input name="protocol" type="search" placeholder="SOL-2026-00001" /></label><button class="button button-primary button-small" type="submit">Filtrar</button><button class="button button-secondary button-small" type="reset">Limpar</button>';
  const statusSelect = form.elements.status; Object.entries(statusLabels).forEach(([value, label]) => statusSelect.add(new Option(label, value)));
  const prioritySelect = form.elements.priority; Object.entries(priorityLabels).forEach(([value, label]) => prioritySelect.add(new Option(label, value)));
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
    ['Solicitante', request.requester_name], ['Origem', request.requester_type === 'VEREADOR' ? 'Vereador' : 'Cidadão'], ['Telefone', request.phone], ['E-mail', request.requester_email || 'Não informado'],
    ['Categoria', categoryLabels[request.category] || request.category], ['Local', request.location], ['Localização GPS', request.latitude !== null && request.longitude !== null ? `${Number(request.latitude).toFixed(6)}, ${Number(request.longitude).toFixed(6)}` : 'Não compartilhada'], ['Bairro', request.neighborhood],
    ['Ponto de referência', request.reference], ['Descrição', request.description], ['Informação complementar', Object.values(specific).join(' · ') || '—'],
    ['Responsável', request.responsible_name || 'Não atribuído'], ['Data de criação', formatDate(request.created_at, true)], ['Última atualização', formatDate(request.updated_at, true)],
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
  const priority = selectOptions(Object.keys(priorityLabels), request.priority, priorityLabels);
  const save = element('button', 'button button-secondary button-small', 'Salvar status e prioridade');
  const team = document.createElement('select'); team.add(new Option('Selecionar equipe', '')); teams.forEach((item) => team.add(new Option(item.name, item.id)));
  const assignee = document.createElement('select');
  const refreshAssignees = () => { assignee.replaceChildren(new Option('Selecionar responsável', '')); maintenanceUsers.filter((user) => { if (String(user.team_id) !== team.value) return false; try { const categories = JSON.parse(user.service_categories || '[]'); return !categories.length || categories.includes(request.category); } catch { return true; } }).forEach((user) => assignee.add(new Option(user.name, user.id))); };
  team.addEventListener('change', refreshAssignees);
  const schedule = document.createElement('input'); schedule.type = 'datetime-local'; schedule.setAttribute('aria-label', 'Data programada');
  const assign = element('button', 'button button-primary button-small', 'Criar ordem de serviço');
  const feedback = element('p', 'inline-feedback');
  save.addEventListener('click', async () => { try { await api(`/api/requests/${encodeURIComponent(request.protocol)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status.value, priority: priority.value }) }); feedback.textContent = 'Solicitação atualizada.'; onUpdate(); } catch (error) { feedback.textContent = error.message; } });
  assign.addEventListener('click', async () => { try { if (!team.value || !assignee.value || !schedule.value) throw new Error('Informe equipe, responsável e data programada.'); await api(`/api/requests/${encodeURIComponent(request.protocol)}/work-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId: team.value, assignedUserId: assignee.value, scheduledAt: schedule.value }) }); feedback.textContent = 'Ordem de serviço criada e atribuída.'; onUpdate(); } catch (error) { feedback.textContent = error.message; } });
  actions.append(status, priority, save, team, assignee, schedule, assign, feedback);
  dialog.append(header, data, createImageGallery(request.images), createHistoryTimeline(request.history), actions); overlay.append(dialog); document.body.append(overlay);
}

function renderTable(requests, teams, maintenanceUsers, reload) {
  const container = element('div', 'request-table-wrap');
  const table = element('table', 'request-table');
  const head = document.createElement('thead'); const row = document.createElement('tr');
  ['Protocolo', 'Data', 'Categoria', 'Local', 'Solicitante', 'Prioridade', 'Status', 'Responsável'].forEach((name) => row.append(element('th', '', name))); head.append(row);
  const body = document.createElement('tbody');
  if (!requests.length) { const empty = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 8; cell.textContent = 'Nenhuma solicitação encontrada com estes filtros.'; empty.append(cell); body.append(empty); }
  requests.forEach((request) => {
    const row = document.createElement('tr');
    const protocolCell = document.createElement('td'); const button = element('button', 'protocol-link', request.protocol); button.type = 'button';
    button.addEventListener('click', async () => { try { const result = await api(`/api/requests/${encodeURIComponent(request.protocol)}`); openDetails(result.request, teams, maintenanceUsers, reload); } catch (error) { window.alert(error.message); } });
    protocolCell.append(button); row.append(protocolCell);
    const requester = element('td', '', request.requester_name);
    if (request.requester_type === 'VEREADOR') requester.append(document.createElement('br'), element('small', 'request-origin-label', 'Origem: Vereador'));
    row.append(element('td', '', formatDate(request.created_at)), element('td', '', categoryLabels[request.category] || request.category), element('td', '', `${request.location} · ${request.neighborhood}`), requester, element('td', '', priorityLabels[request.priority] || request.priority));
    const statusCell = document.createElement('td'); statusCell.append(statusBadge(request.status)); row.append(statusCell); row.append(element('td', '', request.responsible_name || 'Não atribuído')); body.append(row);
  });
  table.append(head, body); container.append(table); return container;
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

function createEmployeeForm(teams, initial = {}) {
  const form = document.createElement('form'); form.className = 'user-form';
  form.innerHTML = '<label class="field">Nome *<input name="name" required /></label><label class="field">Matrícula/identificação <small>opcional</small><input name="employeeNumber" /></label><label class="field" data-maintenance-only>Telefone *<input name="phone" type="tel" /></label><label class="field">E-mail *<input name="email" type="email" required /></label><label class="field" data-maintenance-only>Função *<input name="jobTitle" placeholder="Ex.: Eletricista" /></label><label class="field" data-maintenance-only>Setor *<input name="department" placeholder="Ex.: Iluminação pública" /></label><label class="field">Perfil<select name="role"><option value="VEREADOR">Vereador</option><option value="MANUTENCAO">Manutenção</option><option value="ADMINISTRADOR">Administrador</option></select></label><label class="field" data-maintenance-only>Equipe<select name="teamId"></select></label><fieldset class="service-category-field" data-maintenance-only><legend>Serviços sob responsabilidade</legend><label><input type="checkbox" name="serviceCategories" value="ESTRADAS" /> Estradas</label><label><input type="checkbox" name="serviceCategories" value="LAMPADAS" /> Iluminação</label><label><input type="checkbox" name="serviceCategories" value="LUMINARIAS" /> Luminárias</label></fieldset>';
  addTeamOptions(form.elements.teamId, teams, initial.team_id || initial.teamId || '');
  ['name', 'employeeNumber', 'phone', 'email', 'jobTitle', 'department'].forEach((name) => { if (initial[name] ?? initial[{ employeeNumber: 'employee_number', jobTitle: 'job_title' }[name]]) form.elements[name].value = initial[name] ?? initial[{ employeeNumber: 'employee_number', jobTitle: 'job_title' }[name]]; });
  form.elements.role.value = initial.role || 'MANUTENCAO';
  const categories = categoriesForUser(initial); form.querySelectorAll('[name="serviceCategories"]').forEach((input) => { input.checked = categories.includes(input.value); });
  form.elements.role.addEventListener('change', () => syncInternalProfileForm(form));
  syncInternalProfileForm(form);
  return form;
}

function renderUserManagement(users, teams, reload) {
  const section = element('section', 'dashboard-section user-management');
  section.append(element('p', 'eyebrow', 'Acesso interno'), element('h2', '', 'Funcionários e equipes'), element('p', 'dashboard-notice', 'Somente administradores gerenciam acessos. Funcionários não podem conceder permissões administrativas a si próprios.'));
  const teamForm = document.createElement('form'); teamForm.className = 'team-form';
  teamForm.innerHTML = '<label class="field">Nova equipe<input name="name" minlength="3" placeholder="Ex.: Equipe de Iluminação" required /></label><button class="button button-secondary button-small" type="submit">Criar equipe</button>';
  const teamFeedback = element('p', 'inline-feedback'); teamForm.append(teamFeedback);
  teamForm.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(teamForm))) }); teamFeedback.textContent = 'Equipe criada com sucesso.'; reload(); } catch (error) { teamFeedback.textContent = error.message; } });
  section.append(teamForm, element('h3', '', 'Cadastrar acesso interno'));
  const form = createEmployeeForm(teams);
  const password = document.createElement('label'); password.className = 'field'; password.innerHTML = 'Senha inicial *<input name="password" type="password" minlength="12" required />'; form.append(password);
  const submit = element('button', 'button button-primary button-small', 'Cadastrar usuário'); submit.type = 'submit'; form.append(submit);
  const feedback = element('p', 'inline-feedback'); form.append(feedback);
  form.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFromEmployeeForm(form)) }); feedback.textContent = 'Usuário cadastrado com sucesso.'; reload(); } catch (error) { feedback.textContent = error.message; } });
  const userList = element('div', 'user-list'); userList.append(element('h3', '', 'Acessos internos'));
  users.forEach((user) => {
    const card = element('article', `user-list-card${user.active ? '' : ' is-inactive'}`);
    const summary = element('div', 'user-list-summary');
    const text = element('div'); text.append(element('strong', '', user.name), element('p', '', `${roleLabels[user.role] || user.role} · ${user.job_title || 'Função não informada'}${user.team_name ? ` · ${user.team_name}` : ''}`), element('small', '', user.active ? 'Acesso ativo' : 'Acesso desativado'));
    const edit = element('button', 'button button-secondary button-small', 'Editar'); edit.type = 'button'; summary.append(text, edit); card.append(summary);
    const editor = createEmployeeForm(teams, user); editor.hidden = true;
    const active = document.createElement('label'); active.className = 'field'; active.innerHTML = '<span>Status do acesso</span><select name="active"><option value="true">Ativo</option><option value="false">Inativo</option></select>'; active.querySelector('select').value = user.active ? 'true' : 'false'; editor.append(active);
    const reset = document.createElement('label'); reset.className = 'field'; reset.innerHTML = 'Nova senha <small>opcional</small><input name="password" type="password" minlength="12" />'; editor.append(reset);
    const save = element('button', 'button button-primary button-small', 'Salvar alterações'); save.type = 'submit'; editor.append(save);
    const editorFeedback = element('p', 'inline-feedback'); editor.append(editorFeedback); card.append(editor);
    edit.addEventListener('click', () => { editor.hidden = !editor.hidden; edit.textContent = editor.hidden ? 'Editar' : 'Fechar'; });
    editor.addEventListener('submit', async (event) => { event.preventDefault(); try { await api(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFromEmployeeForm(editor)) }); editorFeedback.textContent = 'Dados atualizados.'; reload(); } catch (error) { editorFeedback.textContent = error.message; } });
    userList.append(card);
  });
  section.append(teamForm, form, userList); return section;
}

async function renderAdministrator() {
  title.textContent = 'Painel administrativo';
  description.textContent = 'Visão consolidada para priorizar, analisar e encaminhar as solicitações municipais.';
  const [teamsResult, usersResult] = await Promise.all([api('/api/teams'), api('/api/users')]);
  const teams = teamsResult.teams;
  const maintenanceUsers = usersResult.users.filter((user) => user.role === 'MANUTENCAO' && user.active);
  content.replaceChildren();
  const requestMap = createRequestMapSection();
  const filtersSection = element('section', 'dashboard-section filters-section'); filtersSection.append(element('h2', '', 'Solicitações')); const tableHost = element('div');
  const loadDashboard = async (filters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    const dashboard = await api(`/api/admin/dashboard?${query}`);
    const statistics = dashboard.statistics;
    const metrics = element('div', 'metrics-grid');
    metrics.append(createMetric('Total de solicitações', statistics.total, 'metric-total'), createMetric('Aguardando análise', statistics.awaiting_analysis, 'metric-awaiting'), createMetric('Aprovadas', statistics.approved, 'metric-approved'), createMetric('Programadas', statistics.scheduled, 'metric-scheduled'), createMetric('Em execução', statistics.in_progress, 'metric-progress'), createMetric('Concluídas', statistics.completed, 'metric-completed'), createMetric('Indeferidas', statistics.rejected, 'metric-rejected'), createMetric('Canceladas', statistics.cancelled, 'metric-cancelled'));
    tableHost.replaceChildren(metrics, renderTable(dashboard.requests, teams, maintenanceUsers, () => loadDashboard(filters)));
  };
  filtersSection.append(createFilters(loadDashboard), tableHost); content.append(requestMap.section, filtersSection, renderUserManagement(usersResult.users, teams, renderAdministrator)); await Promise.all([requestMap.load(), loadDashboard()]);
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
    ['Protocolo', 'Data', 'Serviço', 'Local', 'Prioridade', 'Status', 'Última atualização'].forEach((label) => row.append(element('th', '', label))); head.append(row);
    const body = document.createElement('tbody');
    requests.forEach((request) => {
      const row = document.createElement('tr');
      row.append(element('td', 'protocol-text', request.protocol), element('td', '', formatDate(request.created_at)), element('td', '', categoryLabels[request.category] || request.category), element('td', '', `${request.location} · ${request.neighborhood}`), element('td', '', priorityLabels[request.priority] || request.priority));
      const status = document.createElement('td'); status.append(statusBadge(request.status)); row.append(status, element('td', '', formatDate(request.updated_at, true))); body.append(row);
    });
    table.append(head, body); wrap.append(table); section.append(wrap);
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
