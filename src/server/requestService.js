const { parseCoordinates } = require('./coordinates');

const SERVICE_TYPES = new Set(['ESTRADAS', 'LAMPADAS', 'LUMINARIAS']);
const REQUEST_STATUSES = new Set(['RECEBIDA', 'AGUARDANDO_ANALISE', 'EM_ANALISE', 'INFORMACOES_ADICIONAIS', 'APROVADA', 'PROGRAMADA', 'EM_EXECUCAO', 'CONCLUIDA', 'INDEFERIDA', 'CANCELADA']);
const PRIORITIES = new Set(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']);
const PROTOCOL_PATTERN = /^SOL-\d{4}-\d{5,}$/;

const statusLabels = { RECEBIDA: 'Recebida', AGUARDANDO_ANALISE: 'Aguardando análise', EM_ANALISE: 'Em análise', INFORMACOES_ADICIONAIS: 'Informações adicionais solicitadas', APROVADA: 'Aprovada', PROGRAMADA: 'Programada', EM_EXECUCAO: 'Em execução', CONCLUIDA: 'Concluída', INDEFERIDA: 'Indeferida', CANCELADA: 'Cancelada' };
const priorityLabels = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function phoneDigits(value) {
  return cleanText(value).replace(/\D/g, '');
}

function isValidEmail(value) {
  return !value || /^\S+@\S+\.\S+$/.test(value);
}

function validateRequest(payload, requesterType = 'MUNICIPE') {
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
    ['name', 'Informe seu nome.'],
    ['phone', 'Informe um telefone ou WhatsApp para contato.'],
    ['location', 'Informe o local do problema.'],
    ['neighborhood', 'Informe o bairro.'],
    ['description', 'Descreva o problema encontrado.'],
  ];
  for (const [field, message] of requiredFields) if (!data[field]) return { error: message };
  if (phoneDigits(data.phone).length < 8) return { error: 'Informe um telefone válido para contato.' };
  if (!isValidEmail(data.email)) return { error: 'Informe um e-mail válido ou deixe o campo em branco.' };
  if (!SERVICE_TYPES.has(data.serviceType)) return { error: 'Selecione um tipo de serviço válido.' };
  return { data };
}

function publicRequest(request, history) {
  return {
    protocol: request.protocol,
    category: request.category,
    location: request.location,
    neighborhood: request.neighborhood,
    status: request.status,
    priority: request.priority,
    created_at: request.created_at,
    updated_at: request.updated_at,
    history: history.map((event) => ({ action: event.action, previous_status: event.previous_status, new_status: event.new_status, observation: event.observation, created_at: event.created_at })),
  };
}

class RequestService {
  constructor(repository, photoStorage, imageRepository, auditRepository, notificationService = null) {
    this.repository = repository;
    this.photoStorage = photoStorage;
    this.imageRepository = imageRepository;
    this.auditRepository = auditRepository;
    this.notificationService = notificationService;
  }

  register(payload, requesterUser = null, requestPhoto) {
    const requesterUserId = typeof requesterUser === 'object' ? requesterUser?.id || null : requesterUser;
    const isCouncilMember = typeof requesterUser === 'object' && requesterUser?.role === 'VEREADOR';
    const sourcePayload = isCouncilMember ? { ...payload, name: requesterUser.name } : payload;
    const validation = validateRequest(sourcePayload || {}, isCouncilMember ? 'VEREADOR' : 'MUNICIPE');
    if (validation.error) return validation;
    this.photoStorage.validate(requestPhoto);
    const request = this.repository.create(validation.data, requesterUserId);
    const auditUserId = requesterUserId || this.repository.getPublicAuditUserId();
    let storedPhoto = null;
    try {
      this.auditRepository.record({
        requestId: request.id,
        entityType: 'SOLICITACAO',
        userId: auditUserId,
        action: isCouncilMember ? 'Solicitação criada pelo vereador' : requesterUserId ? 'Solicitação criada' : 'Solicitação criada pelo cidadão',
        newStatus: request.status,
        observation: isCouncilMember ? 'Cadastro identificado como originado por vereador.' : requesterUserId ? 'Solicitação registrada por usuário interno.' : 'Cadastro público registrado sem necessidade de login.',
      });
      storedPhoto = this.photoStorage.save(requestPhoto);
      if (storedPhoto) {
        this.imageRepository.create({ requestId: request.id, imageType: 'SOLICITACAO', photo: storedPhoto, uploadedByUserId: auditUserId });
        this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId: auditUserId, action: 'Foto da solicitação enviada', observation: storedPhoto.originalName });
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
    const normalizedProtocol = cleanText(protocol).toUpperCase();
    if (!PROTOCOL_PATTERN.test(normalizedProtocol)) return { error: 'Informe um protocolo válido. Exemplo: SOL-2026-00001.' };
    const request = this.repository.findByProtocol(normalizedProtocol);
    return request ? { request } : { notFound: true };
  }

  findPublicByProtocol(protocol, phoneLastFour) {
    const result = this.findByProtocol(protocol);
    if (result.error || result.notFound) return result;
    const suppliedDigits = phoneDigits(phoneLastFour);
    if (!/^\d{4}$/.test(suppliedDigits)) return { error: 'Informe os últimos 4 dígitos do telefone usado no cadastro.' };
    if (phoneDigits(result.request.phone).slice(-4) !== suppliedDigits) return { forbidden: true };
    return { request: publicRequest(result.request, this.auditRepository.listForRequest(result.request.id)) };
  }

  listAll() {
    return this.repository.listAll();
  }

  listForCouncilMember(userId) {
    return this.repository.listForRequesterUserId(userId);
  }

  updateManagement(protocol, changes, userId) {
    const normalizedStatus = cleanText(changes.status).toUpperCase();
    const normalizedPriority = cleanText(changes.priority).toUpperCase();
    if (normalizedStatus && !REQUEST_STATUSES.has(normalizedStatus)) return { error: 'Status inválido.' };
    if (normalizedPriority && !PRIORITIES.has(normalizedPriority)) return { error: 'Prioridade inválida.' };
    const previous = this.repository.findByProtocol(protocol);
    if (!previous) return { notFound: true };
    const request = this.repository.updateManagement(protocol, { status: normalizedStatus || null, priority: normalizedPriority || null });
    if (normalizedStatus && normalizedStatus !== previous.status) {
      const actions = { APROVADA: 'Solicitação aprovada pela administração', INDEFERIDA: 'Solicitação indeferida pela administração', INFORMACOES_ADICIONAIS: 'Informações adicionais solicitadas pela administração', CONCLUIDA: 'Solicitação concluída pela administração' };
      this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId, action: actions[normalizedStatus] || `Status alterado de ${statusLabels[previous.status] || previous.status} para ${statusLabels[normalizedStatus] || normalizedStatus}`, previousStatus: previous.status, newStatus: normalizedStatus });
    }
    if (normalizedPriority && normalizedPriority !== previous.priority) {
      this.auditRepository.record({ requestId: request.id, entityType: 'SOLICITACAO', userId, action: `Prioridade alterada de ${priorityLabels[previous.priority] || previous.priority} para ${priorityLabels[normalizedPriority] || normalizedPriority}`, previousPriority: previous.priority, newPriority: normalizedPriority });
    }
    return request ? { request } : { notFound: true };
  }

  getAdministratorDashboard(filters) {
    return { statistics: this.repository.getDashboardStatistics(), requests: this.repository.listForAdministrator(filters) };
  }

  getAdministratorMap(filters) {
    const category = cleanText(filters.category).toUpperCase();
    const status = cleanText(filters.status).toUpperCase();
    if (category && !SERVICE_TYPES.has(category)) return { error: 'Categoria inválida.' };
    if (status && !REQUEST_STATUSES.has(status)) return { error: 'Status inválido.' };
    return { requests: this.repository.listForMap({ category, status }) };
  }
}

module.exports = { RequestService, REQUEST_STATUSES, SERVICE_TYPES };
