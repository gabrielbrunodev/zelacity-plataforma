const REQUEST_STATUSES = new Set(['RECEBIDA', 'EM_ANALISE', 'ENCAMINHADA', 'PENDENTE', 'EM_ATENDIMENTO', 'CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA']);
const REQUEST_SOURCES = new Set(['MUNICIPE', 'VEREADOR', '1DOC', 'ADMINISTRATIVO']);
const PRIORITIES = new Set(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function normalizeId(value) {
  const text = cleanText(value);
  if (!text) return { value: '' };
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > Number.MAX_SAFE_INTEGER) return { error: true };
  return { value: Number(text) };
}

function normalizeFilters(input = {}) {
  const filters = {
    startDate: cleanText(input.startDate),
    endDate: cleanText(input.endDate),
    category: cleanText(input.category).toUpperCase(),
    status: cleanText(input.status).toUpperCase(),
    source: cleanText(input.source).toUpperCase(),
    neighborhood: cleanText(input.neighborhood),
    priority: cleanText(input.priority).toUpperCase(),
    teamId: '',
    employeeId: '',
  };
  const teamId = normalizeId(input.teamId);
  const employeeId = normalizeId(input.employeeId);
  if (filters.startDate && !isCalendarDate(filters.startDate)) return { error: 'Data inicial inválida.' };
  if (filters.endDate && !isCalendarDate(filters.endDate)) return { error: 'Data final inválida.' };
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) return { error: 'A data inicial não pode ser posterior à data final.' };
  if (filters.category.length > 80) return { error: 'Categoria inválida.' };
  if (filters.status && !REQUEST_STATUSES.has(filters.status)) return { error: 'Status inválido.' };
  if (filters.source && !REQUEST_SOURCES.has(filters.source)) return { error: 'Origem inválida.' };
  if (filters.neighborhood.length > 80) return { error: 'O bairro informado é muito extenso.' };
  if (filters.priority && !PRIORITIES.has(filters.priority)) return { error: 'Prioridade inválida.' };
  if (teamId.error) return { error: 'Equipe inválida.' };
  if (employeeId.error) return { error: 'Funcionário inválido.' };
  filters.teamId = teamId.value;
  filters.employeeId = employeeId.value;
  return { filters };
}

class ReportService {
  constructor(repository) {
    this.repository = repository;
  }

  getAdministratorReport(input) {
    const validation = normalizeFilters(input);
    if (validation.error) return validation;
    const { filters } = validation;
    return {
      filters,
      generatedAt: new Date().toISOString(),
      summary: this.repository.getSummary(filters),
      byPeriod: this.repository.listByPeriod(filters),
      byCategory: this.repository.listByCategory(filters),
      byNeighborhood: this.repository.listByNeighborhood(filters),
      bySource: this.repository.listBySource(filters),
      byEmployee: this.repository.listByEmployee(filters),
      byTeam: this.repository.listByTeam(filters),
      servicesByTeam: this.repository.listServicesByTeam(filters),
      requests: this.repository.listRequests(filters),
    };
  }
}

module.exports = { ReportService };
