const CATEGORIES = new Set(['ESTRADAS', 'LAMPADAS', 'LUMINARIAS']);
const REQUEST_STATUSES = new Set(['RECEBIDA', 'AGUARDANDO_ANALISE', 'EM_ANALISE', 'INFORMACOES_ADICIONAIS', 'APROVADA', 'PROGRAMADA', 'EM_EXECUCAO', 'CONCLUIDA', 'INDEFERIDA', 'CANCELADA']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function normalizeFilters(input = {}) {
  const filters = {
    startDate: cleanText(input.startDate),
    endDate: cleanText(input.endDate),
    category: cleanText(input.category).toUpperCase(),
    status: cleanText(input.status).toUpperCase(),
    neighborhood: cleanText(input.neighborhood),
  };
  if (filters.startDate && !isCalendarDate(filters.startDate)) return { error: 'Data inicial inválida.' };
  if (filters.endDate && !isCalendarDate(filters.endDate)) return { error: 'Data final inválida.' };
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) return { error: 'A data inicial não pode ser posterior à data final.' };
  if (filters.category && !CATEGORIES.has(filters.category)) return { error: 'Categoria inválida.' };
  if (filters.status && !REQUEST_STATUSES.has(filters.status)) return { error: 'Status inválido.' };
  if (filters.neighborhood.length > 80) return { error: 'O bairro informado é muito extenso.' };
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
      servicesByTeam: this.repository.listServicesByTeam(filters),
      requests: this.repository.listRequests(filters),
    };
  }
}

module.exports = { ReportService };
