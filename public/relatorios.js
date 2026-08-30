const filtersForm = document.querySelector('#report-filters');
const feedback = document.querySelector('#report-feedback');
const printArea = document.querySelector('#report-print-area');
const userElement = document.querySelector('#reports-user');
const logoutButton = document.querySelector('#logout-button');
const downloadXlsx = document.querySelector('#download-xlsx');
const downloadCsv = document.querySelector('#download-csv');
const printButton = document.querySelector('#print-report');

const statusLabels = { RECEBIDA: 'Recebida', AGUARDANDO_ANALISE: 'Aguardando análise', EM_ANALISE: 'Em análise', INFORMACOES_ADICIONAIS: 'Informações adicionais solicitadas', APROVADA: 'Aprovada', PROGRAMADA: 'Programada', EM_EXECUCAO: 'Em execução', CONCLUIDA: 'Concluída', INDEFERIDA: 'Indeferida', CANCELADA: 'Cancelada' };
const workOrderStatusLabels = { PROGRAMADA: 'Programada', ATRIBUIDA: 'Atribuída', EM_EXECUCAO: 'Em execução', EXECUTADA: 'Executada', PENDENCIA_IDENTIFICADA: 'Pendência identificada', CONFERENCIA: 'Conferência', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
const categoryLabels = { ESTRADAS: 'Manutenção de estradas', LAMPADAS: 'Troca de lâmpadas', LUMINARIAS: 'Instalação de luminárias' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };

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

function formatPeriod(period) {
  if (!period) return 'Sem período';
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(`${period}-01T12:00:00`));
}

function formatHours(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Sem dados';
  const totalMinutes = Math.round(Number(value) * 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days}d ` : ''}${hours}h ${minutes}min`;
}

function currentFilters() {
  return Object.fromEntries(new FormData(filtersForm));
}

function queryForFilters() {
  return new URLSearchParams(Object.entries(currentFilters()).filter(([, value]) => value));
}

async function api(path) {
  const response = await fetch(path);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível gerar o relatório.');
  return result;
}

function filterDescription(filters) {
  const parts = [];
  if (filters.startDate || filters.endDate) parts.push(`Período: ${filters.startDate ? formatDate(`${filters.startDate}T12:00:00Z`) : 'início'} a ${filters.endDate ? formatDate(`${filters.endDate}T12:00:00Z`) : 'hoje'}`);
  if (filters.category) parts.push(`Categoria: ${categoryLabels[filters.category] || filters.category}`);
  if (filters.status) parts.push(`Status: ${statusLabels[filters.status] || filters.status}`);
  if (filters.neighborhood) parts.push(`Bairro: ${filters.neighborhood}`);
  return parts.length ? parts.join(' · ') : 'Todos os registros';
}

function createTable(title, headers, rows) {
  const card = element('section', 'report-table-card');
  card.append(element('h3', '', title));
  const wrap = element('div', 'request-table-wrap report-table-wrap');
  const table = element('table', 'request-table report-table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((header) => headRow.append(element('th', '', header)));
  head.append(headRow);
  const body = document.createElement('tbody');
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = element('td', '', 'Nenhum registro encontrado para estes filtros.');
    cell.colSpan = headers.length;
    row.append(cell);
    body.append(row);
  } else {
    rows.forEach((values) => {
      const row = document.createElement('tr');
      values.forEach((value) => row.append(element('td', '', String(value ?? '—'))));
      body.append(row);
    });
  }
  table.append(head, body); wrap.append(table); card.append(wrap);
  return card;
}

function createSummary(report) {
  const grid = element('div', 'report-summary-grid');
  const items = [
    ['Total de solicitações', report.summary.total_requests, 'metric-total'],
    ['Solicitações concluídas', report.summary.completed_requests, 'metric-completed'],
    ['Solicitações pendentes', report.summary.pending_requests, 'metric-awaiting'],
    ['Tempo médio de atendimento', formatHours(report.summary.average_attendance_hours), 'metric-progress'],
  ];
  items.forEach(([label, value, accent]) => {
    const card = element('article', `report-summary-card ${accent}`);
    card.append(element('span', '', label), element('strong', '', String(value)));
    grid.append(card);
  });
  return grid;
}

function renderReport(report) {
  printArea.replaceChildren();
  const heading = element('div', 'report-print-heading');
  heading.append(element('p', 'eyebrow', 'Zelacity Plataforma · Relatório administrativo'), element('h2', '', 'Consolidado de solicitações'), element('p', '', filterDescription(report.filters)), element('small', '', `Gerado em ${formatDate(report.generatedAt, true)}`));
  const notes = element('p', 'report-definition', 'Pendentes são solicitações ainda abertas; indeferidas e canceladas não entram nesse total. O tempo médio considera solicitações concluídas.');
  const tables = element('div', 'report-tables');
  tables.append(
    createTable('Solicitações por período', ['Período', 'Total', 'Concluídas', 'Pendentes'], report.byPeriod.map((item) => [formatPeriod(item.period), item.total, item.completed, item.pending])),
    createTable('Solicitações por categoria', ['Categoria', 'Total', 'Concluídas', 'Pendentes'], report.byCategory.map((item) => [categoryLabels[item.category] || item.category, item.total, item.completed, item.pending])),
    createTable('Solicitações por bairro', ['Bairro', 'Total', 'Concluídas', 'Pendentes'], report.byNeighborhood.map((item) => [item.neighborhood, item.total, item.completed, item.pending])),
    createTable('Serviços executados por equipe', ['Equipe', 'Serviços executados'], report.servicesByTeam.map((item) => [item.team, item.executed_services])),
    createTable('Detalhamento das solicitações', ['Protocolo', 'Data', 'Categoria', 'Local', 'Bairro', 'Status', 'Prioridade', 'OS', 'Status da OS', 'Equipe', 'Concluída em', 'Tempo de atendimento'], report.requests.map((item) => [item.protocol, formatDate(item.created_at, true), categoryLabels[item.category] || item.category, item.location, item.neighborhood, statusLabels[item.status] || item.status, priorityLabels[item.priority] || item.priority, item.work_order_number || '—', workOrderStatusLabels[item.work_order_status] || item.work_order_status || '—', item.team || '—', formatDate(item.completed_at, true), formatHours(item.attendance_hours)])),
  );
  printArea.append(heading, createSummary(report), notes, tables);
}

async function loadReport() {
  feedback.textContent = 'Gerando relatório…';
  downloadXlsx.disabled = true;
  downloadCsv.disabled = true;
  printButton.disabled = true;
  try {
    const report = await api(`/api/admin/reports?${queryForFilters()}`);
    renderReport(report);
    feedback.textContent = `${report.summary.total_requests} solicitação(ões) encontrada(s).`;
    downloadXlsx.disabled = false;
    downloadCsv.disabled = false;
    printButton.disabled = false;
  } catch (error) {
    feedback.textContent = error.message;
  }
}

function downloadReport(extension) {
  const link = document.createElement('a');
  link.href = `/api/admin/reports/export.${extension}?${queryForFilters()}`;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

Object.entries(statusLabels).forEach(([value, label]) => filtersForm.elements.status.add(new Option(label, value)));
filtersForm.addEventListener('submit', (event) => { event.preventDefault(); loadReport(); });
filtersForm.addEventListener('reset', () => window.setTimeout(loadReport, 0));
downloadXlsx.addEventListener('click', () => downloadReport('xlsx'));
downloadCsv.addEventListener('click', () => downloadReport('csv'));
printButton.addEventListener('click', () => window.print());
logoutButton.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.replace('/'); });

async function initialize() {
  try {
    const { user } = await api('/api/auth/me');
    if (user.role !== 'ADMINISTRADOR') { window.location.replace('/painel.html'); return; }
    userElement.textContent = `Administrador · ${user.name}`;
    await loadReport();
  } catch {
    window.location.replace('/login.html');
  }
}

initialize();
