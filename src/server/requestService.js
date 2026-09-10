const { parseCoordinates } = require('./coordinates');

const SERVICE_TYPES = new Set(['ESTRADAS', 'LAMPADAS', 'LUMINARIAS', 'OUTROS']);
const REQUEST_STATUSES = new Set(['RECEBIDA', 'EM_ANALISE', 'ENCAMINHADA', 'PENDENTE', 'EM_ATENDIMENTO', 'CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA']);
const PRIORITIES = new Set(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']);
const PROTOCOL_PATTERN = /^(?:\d{4}-\d{5,}|SOL-(?:\d{4}-\d{5,}|DEMO-\d{5,}))$/;
const REQUEST_SOURCES = new Set(['MUNICIPE', 'VEREADOR', '1DOC', 'ADMINISTRATIVO']);
const FIELD_LIMITS = { name: 160, phone: 30, email: 254, location: 240, neighborhood: 120, reference: 300, description: 4000 };
const CLOSED_STATUSES = new Set(['CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA']);

const statusLabels = { RECEBIDA: 'Recebida', EM_ANALISE: 'Em análise', ENCAMINHADA: 'Encaminhada', PENDENTE: 'Pendente', EM_ATENDIMENTO: 'Em atendimento', CONCLUIDA: 'Concluída', NAO_REALIZADA: 'Não realizada', CANCELADA: 'Cancelada' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const publicStatus = {
  RECEBIDA: { label: 'Recebida', message: 'Sua solicitação foi recebida e será analisada pela Prefeitura.' },
  EM_ANALISE: { label: 'Em análise', message: 'Sua solicitação está em análise pela Prefeitura.' },
  ENCAMINHADA: { label: 'Encaminhada', message: 'Sua solicitação foi encaminhada para a equipe responsável.' },
  PENDENTE: { label: 'Pendente', message: 'Sua solicitação possui uma pendência e seguirá em acompanhamento pela Prefeitura.' },
  EM_ATENDIMENTO: { label: 'Em atendimento', message: 'O atendimento da sua solicitação está em andamento.' },
  CONCLUIDA: { label: 'Concluída', message: 'O atendimento da sua solicitação foi concluído.' },
  NAO_REALIZADA: { label: 'Não realizada', message: 'A solicitação não pôde ser realizada pela Prefeitura.' },
  CANCELADA: { label: 'Cancelada', message: 'A solicitação foi cancelada pela Prefeitura.' },
};

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProtocol(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/^SOLICITA(?:ÇÃO|CAO)\s*#?\s*/, '')
    .replace(/^#\s*/, '')
    .replace(/\s+/g, '');
}

function phoneDigits(value) {
  return cleanText(value).replace(/\D/g, '');
}

function isValidEmail(value) {
  return !value || /^\S+@\S+\.\S+$/.test(value);
}

function normalizeDeadlineAt(value) {
  const date = cleanText(value);
  if (!date) return { deadlineAt: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Informe um prazo válido.' };
  const parsed = new Date(`${date}T23:59:59.999Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(date)) return { error: 'Informe um prazo válido.' };
  return { deadlineAt: parsed.toISOString() };
}

function deadlineFromCategory(categoryService, categoryCode) {
  const days = categoryService?.getDefaultDeadlineDays(categoryCode);
  if (!days) return null;
  const deadline = new Date();
  deadline.setUTCDate(deadline.getUTCDate() + Number(days));
  deadline.setUTCHours(23, 59, 59, 999);
  return deadline.toISOString();
}

function validateRequest(payload, requesterType = 'MUNICIPE', { allowOptionalPhone = false } = {}) {
  const data = {
    name: cleanText(payload.name),
    requesterType,
    phone: cleanText(payload.phone),
    email: cleanText(payload.email).toLowerCase(),
    serviceType: cleanText(payload.serviceType).toUpperCase(),
    location: cleanText(payload.location),
    neighborhood: cleanText(payload.neighborhood),
    reference: cleanText(payload.reference),
    description: cleanText(payload.description),
    specificDetails: {},
  };

  const coordinateValidation = parseCoordinates(payload.latitude, payload.longitude);
  if (coordinateValidation.error) return coordinateValidation;
  data.latitude = coordinateValidation.coordinates?.latitude ?? null;
  data.longitude = coordinateValidation.coordinates?.longitude ?? null;

  const requiredFields = [
    ['location', 'Informe o local do problema.'],
    ['neighborhood', 'Informe o bairro.'],
    ['description', 'Descreva o problema encontrado.'],
  ];
  if (requesterType !== 'VEREADOR') {
    if (!allowOptionalPhone) requiredFields.unshift(['phone', 'Informe um telefone ou WhatsApp para contato.']);
    requiredFields.unshift(['name', 'Informe seu nome.']);
  }
  for (const [field, message] of requiredFields) if (!data[field]) return { error: message };
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (data[field].length > limit) return { error: `O campo ${field} excede o tamanho permitido.` };
  }
  if (data.phone && phoneDigits(data.phone).length < 8) return { error: 'Informe um telefone válido para contato.' };
  if (!isValidEmail(data.email)) return { error: 'Informe um e-mail válido ou deixe o campo em branco.' };
  if (!data.serviceType) return { error: 'Selecione uma categoria para a solicitação.' };
  return { data };
}

function publicRequest(request, categoryLabel, publicUpdates = []) {
  const progress = publicStatus[request.status] || { label: 'Em análise', message: 'Sua solicitação está sendo analisada pela Prefeitura.' };
  const history = publicUpdates.map((event) => ({
    eventType: event.event_type,
    status: event.new_status ? (publicStatus[event.new_status]?.label || event.new_status) : null,
    message: event.public_update,
    created_at: event.created_at,
  }));
  const latestUpdate = history.at(-1);
  return {
    protocol: request.protocol,
    category: categoryLabel,
    locationSummary: request.neighborhood ? `Bairro ${request.neighborhood}` : 'Local informado',
    status: progress.label,
    message: latestUpdate?.message || progress.message,
    created_at: request.created_at,
    updated_at: request.updated_at,
    history,
  };
}

class RequestService {
  constructor(repository, photoStorage, imageRepository, auditRepository, notificationService = null, categoryService = null) {
    this.repository = repository;
    this.photoStorage = photoStorage;
    this.imageRepository = imageRepository;
    this.auditRepository = auditRepository;
    this.notificationService = notificationService;
    this.categoryService = categoryService;
  }

  register(payload, requesterUser = null, requestPhoto) {
    const requesterUserId = typeof requesterUser === 'object' ? requesterUser?.id || null : requesterUser;
    const isCouncilMember = typeof requesterUser === 'object' && requesterUser?.role === 'VEREADOR';
    const sourcePayload = isCouncilMember ? { ...payload, name: cleanText(payload.name) || 'Solicitante não identificado' } : payload;
    const validation = validateRequest(sourcePayload || {}, isCouncilMember ? 'VEREADOR' : 'MUNICIPE');
    if (validation.error) return validation;
    if (this.categoryService && !this.categoryService.isActive(validation.data.serviceType)) return { error: 'A categoria selecionada não está disponível para novos registros.' };
    this.photoStorage.validate(requestPhoto);
    const request = this.repository.create({
      ...validation.data,
      source: isCouncilMember ? 'VEREADOR' : 'MUNICIPE',
      deadlineAt: deadlineFromCategory(this.categoryService, validation.data.serviceType),
    }, requesterUserId);
    const auditUserId = requesterUserId || this.repository.getPublicAuditUserId();
    let storedPhoto = null;
    try {
      this.auditRepository.record({
        requestId: request.id,
        entityType: 'SOLICITACAO',
        userId: auditUserId,
        eventType: 'SOLICITACAO_CRIADA',
        action: isCouncilMember ? 'Solicitação criada pelo vereador' : requesterUserId ? 'Solicitação criada' : 'Solicitação criada pelo cidadão',
        newStatus: request.status,
        observation: isCouncilMember ? 'Cadastro identificado como originado por vereador.' : requesterUserId ? 'Solicitação registrada por usuário interno.' : 'Cadastro público registrado sem necessidade de login.',
      });
      storedPhoto = this.photoStorage.save(requestPhoto);
      if (storedPhoto) {
        this.imageRepository.create({ requestId: request.id, imageType: 'SOLICITACAO', photo: storedPhoto, uploadedByUserId: auditUserId });
        this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId: auditUserId, eventType: 'FOTO_ADICIONADA', action: 'Foto da solicitação enviada', observation: storedPhoto.originalName });
      }
      let notifications = { channels: [], queued: false };
      try {
        notifications = this.notificationService?.queueProtocol(request) || notifications;
      } catch {
        // O cadastro permanece concluído se uma integração externa estiver indisponível.
      }
      return { request, notifications };
    } catch (error) {
      this.photoStorage.remove(storedPhoto);
      this.repository.removeById(request.id);
      throw error;
    }
  }

  findByProtocol(protocol) {
    const normalizedProtocol = normalizeProtocol(protocol);
    if (!PROTOCOL_PATTERN.test(normalizedProtocol)) return { error: 'Informe um protocolo válido. Exemplo: 2026-00001.' };
    const request = this.repository.findByProtocol(normalizedProtocol);
    return request ? { request } : { notFound: true };
  }

  findPublicByProtocol(protocol) {
    const result = this.findByProtocol(protocol);
    if (result.error || result.notFound) return result;
    const publicUpdates = this.auditRepository.listPublicForRequest(result.request.id);
    return { request: publicRequest(result.request, this.categoryService?.getName(result.request.category) || result.request.category, publicUpdates) };
  }

  listAll() {
    return this.repository.listAll();
  }

  listForCouncilMember(userId) {
    return this.repository.listForRequesterUserId(userId);
  }

  createManual(payload, administrator, requestPhoto) {
    const source = cleanText(payload.source).toUpperCase() || 'ADMINISTRATIVO';
    if (!['1DOC', 'ADMINISTRATIVO'].includes(source)) return { error: 'Origem manual inválida.' };
    const validation = validateRequest(payload || {}, 'MUNICIPE', { allowOptionalPhone: source === '1DOC' });
    if (validation.error) return validation;
    if (this.categoryService && !this.categoryService.isActive(validation.data.serviceType)) return { error: 'A categoria selecionada não está disponível para novos registros.' };
    const externalProtocol = cleanText(payload.externalProtocol).toUpperCase();
    if (source === '1DOC' && !externalProtocol) return { error: 'Informe o protocolo do 1Doc para esta solicitação.' };
    if (externalProtocol.length > 120) return { error: 'O protocolo externo pode ter no máximo 120 caracteres.' };
    const priority = cleanText(payload.priority).toUpperCase() || 'NORMAL';
    if (!PRIORITIES.has(priority)) return { error: 'Prioridade inválida.' };
    const internalObservation = cleanText(payload.internalObservation);
    if (internalObservation.length > 2000) return { error: 'A observação interna pode ter no máximo 2.000 caracteres.' };
    const receivedAtValue = cleanText(payload.receivedAt);
    const receivedAt = receivedAtValue ? new Date(`${receivedAtValue}T12:00:00.000Z`) : null;
    if (source === '1DOC' && !receivedAtValue) return { error: 'Informe a data de recebimento no 1Doc.' };
    if (receivedAtValue && Number.isNaN(receivedAt.getTime())) return { error: 'Informe uma data de recebimento válida.' };
    const deadline = normalizeDeadlineAt(payload.deadlineAt);
    if (deadline.error) return deadline;
    this.photoStorage.validate(requestPhoto);
    const request = this.repository.create({
      ...validation.data,
      source,
      externalProtocol,
      priority,
      receivedAt: receivedAt?.toISOString() || null,
      deadlineAt: deadline.deadlineAt || deadlineFromCategory(this.categoryService, validation.data.serviceType),
    }, null, administrator.id);
    let storedPhoto = null;
    try {
      this.auditRepository.record({
        requestId: request.id,
        entityType: 'SOLICITACAO',
        userId: administrator.id,
        eventType: 'SOLICITACAO_CRIADA',
        action: source === '1DOC' ? 'Solicitação cadastrada manualmente a partir do 1Doc' : 'Solicitação cadastrada manualmente pela administração',
        newStatus: request.status,
        observation: [
          externalProtocol ? `Protocolo externo vinculado: ${externalProtocol}.` : '',
          receivedAt ? `Recebido no 1Doc em ${receivedAt.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.` : '',
          internalObservation,
        ].filter(Boolean).join('\n') || null,
      });
      storedPhoto = this.photoStorage.save(requestPhoto);
      if (storedPhoto) {
        this.imageRepository.create({ requestId: request.id, imageType: 'SOLICITACAO', photo: storedPhoto, uploadedByUserId: administrator.id });
        this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId: administrator.id, eventType: 'FOTO_ADICIONADA', action: 'Foto da solicitação enviada', observation: storedPhoto.originalName });
      }
      return { request };
    } catch (error) {
      this.photoStorage.remove(storedPhoto);
      this.repository.removeById(request.id);
      throw error;
    }
  }

  updateManagement(protocol, changes, userId) {
    const normalizedStatus = cleanText(changes.status).toUpperCase();
    const normalizedPriority = cleanText(changes.priority).toUpperCase();
    const internalObservation = cleanText(changes.internalObservation);
    const publicUpdate = cleanText(changes.publicUpdate);
    const hasDeadlineAt = Object.hasOwn(changes, 'deadlineAt');
    const deadline = hasDeadlineAt ? normalizeDeadlineAt(changes.deadlineAt) : { deadlineAt: undefined };
    if (normalizedStatus && !REQUEST_STATUSES.has(normalizedStatus)) return { error: 'Status inválido.' };
    if (normalizedPriority && !PRIORITIES.has(normalizedPriority)) return { error: 'Prioridade inválida.' };
    if (internalObservation.length > 2000) return { error: 'A observação interna pode ter no máximo 2.000 caracteres.' };
    if (publicUpdate.length > 1000) return { error: 'A atualização pública pode ter no máximo 1.000 caracteres.' };
    if (deadline.error) return deadline;
    const previous = this.repository.findByProtocol(protocol);
    if (!previous) return { notFound: true };
    const request = this.repository.updateManagement(protocol, {
      status: normalizedStatus || null,
      priority: normalizedPriority || null,
      deadlineAt: deadline.deadlineAt,
      touch: Boolean(internalObservation || publicUpdate),
    });
    if (normalizedStatus && normalizedStatus !== previous.status) {
      const isReopen = CLOSED_STATUSES.has(previous.status) && !CLOSED_STATUSES.has(normalizedStatus);
      this.auditRepository.record({
        requestId: request.id,
        entityType: 'SOLICITACAO',
        userId,
        eventType: isReopen ? 'SOLICITACAO_REABERTA' : 'STATUS_ALTERADO',
        action: isReopen ? `Solicitação reaberta: ${statusLabels[previous.status] || previous.status} para ${statusLabels[normalizedStatus] || normalizedStatus}` : `Status alterado de ${statusLabels[previous.status] || previous.status} para ${statusLabels[normalizedStatus] || normalizedStatus}`,
        previousStatus: previous.status,
        newStatus: normalizedStatus,
        observation: internalObservation || null,
        publicUpdate: publicUpdate || null,
      });
    } else if (internalObservation || publicUpdate) {
      this.auditRepository.record({
        requestId: request.id,
        entityType: 'SOLICITACAO',
        userId,
        eventType: publicUpdate ? 'ATUALIZACAO_PUBLICA' : 'OBSERVACAO_ADICIONADA',
        action: publicUpdate ? 'Atualização pública registrada' : 'Observação interna adicionada',
        previousStatus: previous.status,
        newStatus: previous.status,
        observation: internalObservation || null,
        publicUpdate: publicUpdate || null,
      });
    }
    if (normalizedPriority && normalizedPriority !== previous.priority) {
      this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId, eventType: 'PRIORIDADE_ALTERADA', action: `Prioridade alterada de ${priorityLabels[previous.priority] || previous.priority} para ${priorityLabels[normalizedPriority] || normalizedPriority}`, previousPriority: previous.priority, newPriority: normalizedPriority });
    }
    if (hasDeadlineAt && deadline.deadlineAt !== (previous.deadline_at || null)) {
      this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId, eventType: 'PRAZO_ALTERADO', action: deadline.deadlineAt ? 'Prazo da solicitação definido' : 'Prazo da solicitação removido', observation: deadline.deadlineAt || null });
    }
    if (Object.hasOwn(changes, 'externalProtocol')) {
      const externalProtocol = cleanText(changes.externalProtocol).toUpperCase();
      if (externalProtocol.length > 120) return { error: 'O protocolo externo pode ter no máximo 120 caracteres.' };
      const updated = this.repository.updateExternalProtocol(protocol, externalProtocol || null);
      if (externalProtocol !== (previous.external_protocol || '')) {
        this.auditRepository.record({ requestId: updated.id, entityType: 'SOLICITACAO', userId, eventType: 'PROTOCOLO_1DOC_VINCULADO', action: externalProtocol ? 'Protocolo do 1Doc vinculado' : 'Vínculo com protocolo externo removido', observation: externalProtocol || null });
      }
      return { request: updated };
    }
    return request ? { request } : { notFound: true };
  }

  getAdministratorDashboard(filters) {
    return { statistics: this.repository.getDashboardStatistics(filters), requests: this.repository.listForAdministrator(filters) };
  }

  getAdministratorMap(filters) {
    const category = cleanText(filters.category).toUpperCase();
    const status = cleanText(filters.status).toUpperCase();
    if (category && !(this.categoryService ? this.categoryService.exists(category) : SERVICE_TYPES.has(category))) return { error: 'Categoria inválida.' };
    if (status && !REQUEST_STATUSES.has(status)) return { error: 'Status inválido.' };
    return { requests: this.repository.listForMap({ category, status }) };
  }
}

module.exports = { RequestService, REQUEST_STATUSES, SERVICE_TYPES, REQUEST_SOURCES };
