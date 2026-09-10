const DEFAULT_CATEGORY_CODES = new Set(['ESTRADAS', 'LAMPADAS', 'LUMINARIAS', 'OUTROS']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeActive(value) {
  return ![false, 0, '0', 'false', 'FALSE'].includes(value);
}

function normalizeDefaultDeadlineDays(value) {
  if (value === undefined) return undefined;
  if (value === null || cleanText(String(value)) === '') return null;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return 'Prazo padrão inválido. Informe entre 1 e 3.650 dias ou deixe em branco.';
  return days;
}

function categoryCode(value) {
  return cleanText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

class CategoryService {
  constructor(repository) {
    this.repository = repository;
  }

  listPublic() {
    return this.repository.list();
  }

  listManagement() {
    return this.repository.list({ includeInactive: true });
  }

  isActive(code) {
    const category = this.repository.findByCode(cleanText(code).toUpperCase());
    return Boolean(category?.active);
  }

  exists(code) {
    return Boolean(this.repository.findByCode(cleanText(code).toUpperCase()));
  }

  getName(code) {
    const category = this.repository.findByCode(cleanText(code).toUpperCase());
    return category?.name || cleanText(code);
  }

  getDefaultDeadlineDays(code) {
    return this.repository.findByCode(cleanText(code).toUpperCase())?.default_deadline_days || null;
  }

  create(changes) {
    const name = cleanText(changes.name);
    const code = categoryCode(changes.code || name);
    const defaultDeadlineDays = normalizeDefaultDeadlineDays(changes.defaultDeadlineDays);
    if (name.length < 3) return { error: 'Informe um nome de categoria com pelo menos 3 caracteres.' };
    if (code.length < 3) return { error: 'Informe um nome que permita identificar a categoria.' };
    if (typeof defaultDeadlineDays === 'string') return { error: defaultDeadlineDays };
    try {
      return { category: this.repository.create({ code, name, defaultDeadlineDays: defaultDeadlineDays ?? null }) };
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return { error: 'Já existe uma categoria com esse nome ou código.' };
      throw error;
    }
  }

  update(code, changes) {
    const normalizedCode = cleanText(code).toUpperCase();
    const current = this.repository.findByCode(normalizedCode);
    if (!current) return { notFound: true };
    const name = Object.hasOwn(changes, 'name') ? cleanText(changes.name) : undefined;
    const active = Object.hasOwn(changes, 'active') ? normalizeActive(changes.active) : undefined;
    const defaultDeadlineDays = Object.hasOwn(changes, 'defaultDeadlineDays') ? normalizeDefaultDeadlineDays(changes.defaultDeadlineDays) : undefined;
    if (name !== undefined && name.length < 3) return { error: 'Informe um nome de categoria com pelo menos 3 caracteres.' };
    if (typeof defaultDeadlineDays === 'string') return { error: defaultDeadlineDays };
    return { category: this.repository.update(normalizedCode, { name, active, defaultDeadlineDays }) };
  }
}

module.exports = { CategoryService, DEFAULT_CATEGORY_CODES, categoryCode };
