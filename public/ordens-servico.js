const ordersContent = document.querySelector('#work-orders-content');
const ordersDescription = document.querySelector('#orders-description');
const createOrderLink = document.querySelector('#create-order-link');
const logoutButton = document.querySelector('#logout-button');

const osStatusLabels = { PROGRAMADA: 'Programada', ATRIBUIDA: 'Atribuída', EM_EXECUCAO: 'Em execução', EXECUTADA: 'Executada', CONFERENCIA: 'Conferência', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
const osPriorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const osCategoryLabels = { ESTRADAS: 'Manutenção de estradas', LAMPADAS: 'Troca de lâmpadas', LUMINARIAS: 'Instalação de luminárias' };

function formatDate(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Não programada'; }
function el(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
async function api(path, options = {}) { const response = await fetch(path, options); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.'); return result; }

function renderOrders(workOrders, isAdmin) {
  const wrap = el('div', 'request-table-wrap'); const table = el('table', 'request-table');
  const head = document.createElement('thead'); const headRow = document.createElement('tr'); ['OS', 'Protocolo', 'Categoria', 'Local', 'Prioridade', 'Equipe', 'Responsável', 'Programada', 'Status'].forEach((name) => headRow.append(el('th', '', name))); head.append(headRow);
  const body = document.createElement('tbody');
  if (!workOrders.length) { const row = document.createElement('tr'); const cell = el('td', '', 'Nenhuma ordem de serviço encontrada.'); cell.colSpan = 9; row.append(cell); body.append(row); }
  workOrders.forEach((order) => {
    const row = document.createElement('tr'); const numberCell = document.createElement('td'); const number = el('button', 'protocol-link', order.number); number.type = 'button'; number.addEventListener('click', () => openDetails(order, isAdmin)); numberCell.append(number); row.append(numberCell);
    row.append(el('td', '', order.protocol), el('td', '', osCategoryLabels[order.category] || order.category), el('td', '', order.location), el('td', '', osPriorityLabels[order.priority] || order.priority), el('td', '', order.team_name), el('td', '', order.assigned_user_name || 'Não atribuído'), el('td', '', formatDate(order.scheduled_at)));
    const statusCell = document.createElement('td'); statusCell.append(el('span', 'status-badge', osStatusLabels[order.status] || order.status)); row.append(statusCell); body.append(row);
  });
  table.append(head, body); wrap.append(table); ordersContent.replaceChildren(wrap);
}

function openDetails(order, isAdmin) {
  const overlay = el('div', 'detail-overlay'); const dialog = el('section', 'request-detail-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const header = el('div', 'dialog-header'); const heading = el('div'); heading.append(el('p', 'eyebrow', 'Ordem de serviço'), el('h2', '', order.number)); const close = el('button', 'dialog-close', '×'); close.type = 'button'; close.addEventListener('click', () => overlay.remove()); header.append(heading, close);
  const details = el('dl', 'detail-list'); [['Protocolo relacionado', order.protocol], ['Categoria', osCategoryLabels[order.category] || order.category], ['Local', order.location], ['Descrição', order.description], ['Prioridade', osPriorityLabels[order.priority] || order.priority], ['Equipe responsável', order.team_name], ['Responsável', order.assigned_user_name || 'Não atribuído'], ['Data de criação', formatDate(order.created_at)], ['Data programada', formatDate(order.scheduled_at)], ['Status', osStatusLabels[order.status] || order.status]].forEach(([name, value]) => { const line = el('div'); line.append(el('dt', '', name), el('dd', '', value)); details.append(line); });
  dialog.append(header, details);
  if (isAdmin) { const management = el('section', 'detail-management'); management.append(el('h3', '', 'Atualizar ordem de serviço')); const status = document.createElement('select'); Object.entries(osStatusLabels).forEach(([value, label]) => status.add(new Option(label, value, false, value === order.status))); const schedule = document.createElement('input'); schedule.type = 'datetime-local'; if (order.scheduled_at) schedule.value = new Date(order.scheduled_at).toISOString().slice(0, 16); const save = el('button', 'button button-primary button-small', 'Salvar atualização'); const feedback = el('p', 'inline-feedback'); save.addEventListener('click', async () => { try { await api(`/api/work-orders/${encodeURIComponent(order.number)}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ status:status.value, scheduledAt:schedule.value }) }); feedback.textContent = 'Ordem de serviço atualizada.'; } catch(error) { feedback.textContent = error.message; } }); management.append(status, schedule, save, feedback); dialog.append(management); }
  overlay.append(dialog); document.body.append(overlay);
}

async function initialize() {
  try { const { user } = await api('/api/auth/me'); if (!['ADMINISTRADOR', 'MANUTENCAO'].includes(user.role)) { window.location.replace('/painel.html'); return; } if (user.role !== 'ADMINISTRADOR') { createOrderLink.hidden = true; ordersDescription.textContent = user.teamName ? `Ordens atribuídas à equipe ${user.teamName}.` : ordersDescription.textContent; } const { workOrders } = await api('/api/work-orders'); renderOrders(workOrders, user.role === 'ADMINISTRADOR'); } catch { window.location.replace('/login.html'); }
}

logoutButton.addEventListener('click', async () => { await fetch('/api/auth/logout', { method:'POST' }); window.location.replace('/'); });
initialize();
