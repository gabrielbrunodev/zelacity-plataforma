const UPDATE_TYPES = new Set(['INICIO', 'EXECUCAO', 'OBSERVACAO']);
const WORK_ORDER_STATUSES = new Set(['PROGRAMADA', 'ATRIBUIDA', 'EM_EXECUCAO', 'EXECUTADA', 'PENDENCIA_IDENTIFICADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA']);
const PENDING_REASONS = new Set(['FALTA_MATERIAL', 'EQUIPAMENTO_INDISPONIVEL', 'LOCAL_NAO_ENCONTRADO', 'AVALIACAO_TECNICA', 'CONDICOES_CLIMATICAS', 'ACESSO_IMPOSSIBILITADO', 'OUTRO']);
const NUMBER_PATTERN = /^OS-\d{4}-\d{5,}$/;
const { parseCoordinates } = require('./coordinates');

const statusLabels = { PROGRAMADA: 'Programada', ATRIBUIDA: 'Atribuída', EM_EXECUCAO: 'Em execução', EXECUTADA: 'Executada', PENDENCIA_IDENTIFICADA: 'Pendência identificada', CONFERENCIA: 'Conferência', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
const pendingReasonLabels = { FALTA_MATERIAL: 'Falta de material', EQUIPAMENTO_INDISPONIVEL: 'Equipamento indisponível', LOCAL_NAO_ENCONTRADO: 'Local não encontrado', AVALIACAO_TECNICA: 'Necessita avaliação técnica', CONDICOES_CLIMATICAS: 'Condições climáticas', ACESSO_IMPOSSIBILITADO: 'Acesso ao local impossibilitado', OUTRO: 'Outro' };

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function canHandleWorkOrder(user, workOrder) {
  if (user.role !== 'MANUTENCAO') return true;
  const categories = Array.isArray(user.serviceCategories) ? user.serviceCategories : [];
  const categoryAuthorized = !categories.length || categories.includes(workOrder.category);
  if (!categoryAuthorized) return false;
  // A categoria define o grupo operacional autorizado: todos os funcionários
  // habilitados para ela podem acompanhar e executar a demanda. O vínculo de
  // equipe continua sendo usado como fallback para cadastros legados sem
  // categorias configuradas.
  if (categories.length && categories.includes(workOrder.category)) return true;
  return workOrder.team_id === user.teamId && (!workOrder.assigned_user_id || workOrder.assigned_user_id === user.id);
}

class WorkOrderService {
  constructor(repository, photoStorage, auditRepository, imageRepository = null, { requireAfterExecutionPhoto = false } = {}, internalNotificationService = null) {
    this.repository = repository;
    this.photoStorage = photoStorage;
    this.auditRepository = auditRepository;
    this.imageRepository = imageRepository;
    this.requireAfterExecutionPhoto = requireAfterExecutionPhoto;
    this.internalNotificationService = internalNotificationService;
  }

  notifySafely(callback) {
    try { callback?.(); } catch { /* Uma falha de entrega nunca interrompe a gestão da OS. */ }
  }

  listTeams() {
    return this.repository.listTeams();
  }

  createTeam(name) {
    const normalizedName = String(name || '').trim();
    if (normalizedName.length < 3) return { error: 'Informe um nome de equipe com pelo menos 3 caracteres.' };
    try {
      return { team: this.repository.createTeam(normalizedName) };
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return { error: 'Já existe uma equipe com esse nome.' };
      throw error;
    }
  }

  create(protocol, { teamId, assignedUserId, scheduledAt }, administratorId) {
    const normalizedTeamId = Number(teamId);
    const normalizedAssigneeId = assignedUserId ? Number(assignedUserId) : null;
    const normalizedSchedule = toIsoDate(scheduledAt);
    if (!Number.isInteger(normalizedTeamId) || normalizedTeamId < 1) return { error: 'Selecione uma equipe válida.' };
    if (assignedUserId && (!Number.isInteger(normalizedAssigneeId) || normalizedAssigneeId < 1)) return { error: 'Responsável inválido.' };
    if (!normalizedSchedule) return { error: 'Informe a data programada da ordem de serviço.' };
    const result = this.repository.createForRequest(protocol, { teamId: normalizedTeamId, assignedUserId: normalizedAssigneeId, scheduledAt: normalizedSchedule }, administratorId);
    if (!result.workOrder) return result;
    const workOrder = result.workOrder;
    this.auditRepository.record({
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      entityType: 'ORDEM_SERVICO',
      userId: administratorId,
      eventType: 'ORDEM_SERVICO_CRIADA',
      action: 'OS criada',
      newStatus: workOrder.status,
      observation: `${workOrder.number} criada para a solicitação ${workOrder.protocol}.`,
    });
    {
      this.auditRepository.record({
        requestId: workOrder.request_id,
        workOrderId: workOrder.id,
        entityType: 'ORDEM_SERVICO',
        userId: administratorId,
        eventType: 'ATRIBUICAO',
        action: `OS atribuída à ${workOrder.team_name}`,
        newStatus: workOrder.status,
        observation: workOrder.assigned_user_name ? `Responsável: ${workOrder.assigned_user_name}.` : null,
      });
    }
    this.notifySafely(() => this.internalNotificationService?.notifyAssignment(workOrder, { createdByUserId: administratorId }));
    return result;
  }

  listForUser(user) {
    if (user.role === 'MANUTENCAO' && !user.teamId) return [];
    return this.repository.listForUser(user);
  }

  findByNumber(number, user) {
    const normalizedNumber = String(number || '').trim().toUpperCase();
    if (!NUMBER_PATTERN.test(normalizedNumber)) return { error: 'Número de OS inválido.' };
    const workOrder = this.repository.findByNumber(normalizedNumber);
    if (!workOrder) return { notFound: true };
    if (!canHandleWorkOrder(user, workOrder)) return { forbidden: true };
    return { workOrder };
  }

  updateManagement(number, changes, userId) {
    const current = this.repository.findByNumber(String(number || '').trim().toUpperCase());
    if (!current) return { notFound: true };
    const teamId = changes.teamId ? Number(changes.teamId) : null;
    const assignedUserId = Object.hasOwn(changes, 'assignedUserId') ? (changes.assignedUserId ? Number(changes.assignedUserId) : null) : undefined;
    const scheduledAt = Object.hasOwn(changes, 'scheduledAt') ? toIsoDate(changes.scheduledAt) : undefined;
    const status = String(changes.status || '').trim().toUpperCase();
    if (teamId && (!Number.isInteger(teamId) || teamId < 1)) return { error: 'Equipe inválida.' };
    const effectiveTeamId = teamId || current.team_id;
    const assignee = assignedUserId ? this.repository.findTeamMember(effectiveTeamId, assignedUserId) : null;
    if (assignedUserId && (!Number.isInteger(assignedUserId) || !assignee)) return { error: 'O responsável deve pertencer à equipe selecionada.' };
    if (assignee && !this.repository.canHandleCategory(assignee, current.category)) return { error: 'O responsável selecionado não está habilitado para esta categoria de serviço.' };
    if (Object.hasOwn(changes, 'scheduledAt') && !scheduledAt) return { error: 'Data programada inválida.' };
    if (status && !WORK_ORDER_STATUSES.has(status)) return { error: 'Status da OS inválido.' };
    const workOrder = this.repository.updateManagement(current.number, { teamId, assignedUserId, scheduledAt, status: status || null });
    if (status && status !== current.status) {
      this.auditRepository.record({
        requestId: workOrder.request_id,
        workOrderId: workOrder.id,
        entityType: 'ORDEM_SERVICO',
        userId,
        eventType: 'STATUS_ALTERADO',
        action: `Status da OS alterado de ${statusLabels[current.status] || current.status} para ${statusLabels[status] || status}`,
        previousStatus: current.status,
        newStatus: status,
      });
    }
    if (workOrder.team_id !== current.team_id || workOrder.assigned_user_id !== current.assigned_user_id) {
      this.auditRepository.record({
        requestId: workOrder.request_id,
        workOrderId: workOrder.id,
        entityType: 'ORDEM_SERVICO',
        userId,
        eventType: 'REDISTRIBUICAO',
        action: `OS atribuída à ${workOrder.team_name}`,
        newStatus: workOrder.status,
        observation: workOrder.assigned_user_name ? `Responsável: ${workOrder.assigned_user_name}.` : 'Sem responsável definido.',
      });
    }
    if (scheduledAt && scheduledAt !== current.scheduled_at) {
      this.auditRepository.record({
        requestId: workOrder.request_id,
        workOrderId: workOrder.id,
        entityType: 'ORDEM_SERVICO',
        userId,
        eventType: 'PRAZO_ALTERADO',
        action: 'Data programada da OS alterada',
        observation: `Nova programação: ${new Date(scheduledAt).toLocaleString('pt-BR')}.`,
      });
    }
    if (workOrder.team_id !== current.team_id || workOrder.assigned_user_id !== current.assigned_user_id) {
      this.notifySafely(() => this.internalNotificationService?.notifyAssignment(workOrder, { redistributed: true, createdByUserId: userId }));
    } else if (status && status !== current.status) {
      this.notifySafely(() => this.internalNotificationService?.notifyImportantChange(workOrder, `Status da ordem alterado para ${statusLabels[status] || status}.`, userId));
    } else if (scheduledAt && scheduledAt !== current.scheduled_at) {
      this.notifySafely(() => this.internalNotificationService?.notifyImportantChange(workOrder, `Nova programação: ${new Date(scheduledAt).toLocaleString('pt-BR')}.`, userId));
    }
    return { workOrder };
  }

  sendAdministrativeMessage(number, userId, message) {
    const workOrder = this.repository.findByNumber(String(number || '').trim().toUpperCase());
    if (!workOrder) return { notFound: true };
    if (!this.internalNotificationService) return { error: 'A central de notificações não está disponível.' };
    return this.internalNotificationService.sendAdministrativeMessage(workOrder, message, userId);
  }

  registerUpdate(workOrderId, user, { type, description }) {
    const normalizedType = String(type || '').trim().toUpperCase();
    const normalizedDescription = String(description || '').trim();
    if (!UPDATE_TYPES.has(normalizedType)) return { error: 'Tipo de atualização inválido.' };
    if (!normalizedDescription) return { error: 'Descreva a atualização.' };
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (!canHandleWorkOrder(user, workOrder)) return { forbidden: true };
    if (normalizedType === 'INICIO') return this.start(workOrderId, user, normalizedDescription);
    if (normalizedType === 'EXECUCAO') return { error: 'Use a finalização do serviço para registrar execução, fotos e horário.' };
    const result = this.repository.addUpdate(Number(workOrderId), user.id, normalizedType, normalizedDescription);
    if (result.workOrder) {
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'OBSERVACAO_ADICIONADA', action: 'Observação registrada na OS', observation: normalizedDescription });
    }
    return result;
  }

  start(workOrderId, user, description = 'Serviço iniciado pela equipe de manutenção.') {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (!canHandleWorkOrder(user, workOrder)) return { forbidden: true };
    if (!['PROGRAMADA', 'ATRIBUIDA'].includes(workOrder.status)) return { error: 'Esta ordem de serviço não pode ser iniciada no status atual.' };
    const result = this.repository.addUpdate(Number(workOrderId), user.id, 'INICIO', description);
    if (result.workOrder) {
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'SERVICO_INICIADO', action: 'Serviço iniciado', previousStatus: workOrder.status, newStatus: result.workOrder.status, observation: description });
      this.updateRequestStatus(workOrder, user, 'EM_ATENDIMENTO', 'Atendimento iniciado pela equipe', description, 'O atendimento da sua solicitação foi iniciado.');
    }
    return result;
  }

  autoRouteRequest(protocol, { createdByUserId = null } = {}) {
    const normalizedProtocol = String(protocol || '').trim().toUpperCase();
    const request = this.repository.database.prepare('SELECT category FROM requests WHERE protocol = ?').get(normalizedProtocol);
    if (!request) return { notFound: true };
    const routing = this.repository.findAutomaticRouting(request.category);
    if (!routing) return { skipped: true, reason: 'equipe-indisponivel' };
    const creatorId = createdByUserId || this.repository.getPublicAuditUserId();
    const result = this.repository.createAutomaticForRequest(normalizedProtocol, routing, creatorId);
    if (!result.workOrder || result.alreadyExists) return result;
    const workOrder = result.workOrder;
    this.auditRepository.record({
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      entityType: 'SOLICITACAO',
      userId: creatorId,
      eventType: 'STATUS_ALTERADO',
      action: 'Solicitação encaminhada automaticamente para a equipe responsável',
      previousStatus: 'RECEBIDA',
      newStatus: 'ENCAMINHADA',
      publicUpdate: 'Sua solicitação foi encaminhada para a equipe responsável.',
    });
    this.auditRepository.record({
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      entityType: 'ORDEM_SERVICO',
      userId: creatorId,
      eventType: 'ORDEM_SERVICO_CRIADA',
      action: 'OS criada automaticamente por categoria',
      newStatus: workOrder.status,
      observation: `${workOrder.number} criada para a solicitação ${workOrder.protocol}.`,
    });
    this.notifySafely(() => this.internalNotificationService?.notifyAssignment(workOrder, { createdByUserId: creatorId }));
    return result;
  }

  addPhoto(workOrderId, user, photo) {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (!canHandleWorkOrder(user, workOrder)) return { forbidden: true };
    if (!this.imageRepository) throw new Error('O armazenamento de imagens não está disponível.');
    this.photoStorage.validate(photo);
    const storedPhoto = this.photoStorage.save(photo);
    try {
      const image = this.imageRepository.create({ requestId: workOrder.request_id, workOrderId: workOrder.id, imageType: 'ANTES_EXECUCAO', photo: storedPhoto, uploadedByUserId: user.id });
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'FOTO_ADICIONADA', action: 'Foto adicionada em campo', observation: storedPhoto.originalName });
      return { workOrder: this.repository.findById(workOrder.id), image };
    } catch (error) {
      this.photoStorage.remove(storedPhoto);
      throw error;
    }
  }

  complete(workOrderId, user, { observation, materialsUsed, beforePhoto, afterPhoto, latitude, longitude }) {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (!canHandleWorkOrder(user, workOrder)) return { forbidden: true };
    if (workOrder.status !== 'EM_EXECUCAO') return { error: 'A ordem de serviço precisa estar em execução para ser finalizada.' };
    const normalizedObservation = String(observation || '').trim();
    const normalizedMaterialsUsed = String(materialsUsed || '').trim();
    const executedAt = new Date().toISOString();
    if (!normalizedObservation) return { error: 'Informe uma observação sobre a execução.' };
    if (normalizedMaterialsUsed.length > 1000) return { error: 'Os materiais utilizados podem ter no máximo 1.000 caracteres.' };
    if (this.requireAfterExecutionPhoto && !afterPhoto) return { error: 'Envie a foto depois da execução para concluir o serviço.' };
    const coordinateValidation = parseCoordinates(latitude, longitude);
    if (coordinateValidation.error) return coordinateValidation;

    this.photoStorage.validate(beforePhoto);
    this.photoStorage.validate(afterPhoto);
    let beforeStoredPhoto = null;
    let afterStoredPhoto = null;
    let result;
    try {
      beforeStoredPhoto = this.photoStorage.save(beforePhoto);
      afterStoredPhoto = this.photoStorage.save(afterPhoto);
      result = this.repository.completeExecution(Number(workOrderId), user.id, {
        observation: normalizedObservation,
        materialsUsed: normalizedMaterialsUsed,
        beforePhoto: beforeStoredPhoto,
        afterPhoto: afterStoredPhoto,
        latitude: coordinateValidation.coordinates?.latitude ?? null,
        longitude: coordinateValidation.coordinates?.longitude ?? null,
        executedAt,
      });
    } catch (error) {
      this.photoStorage.remove(beforeStoredPhoto);
      this.photoStorage.remove(afterStoredPhoto);
      throw error;
    }
    if (result.error) {
      this.photoStorage.remove(beforeStoredPhoto);
      this.photoStorage.remove(afterStoredPhoto);
      return result;
    }
    const executionSummary = normalizedMaterialsUsed ? `${normalizedObservation}\nMateriais utilizados: ${normalizedMaterialsUsed}` : normalizedObservation;
    this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'SERVICO_CONCLUIDO', action: 'Serviço concluído', previousStatus: workOrder.status, newStatus: result.workOrder.status, observation: executionSummary });
    this.updateRequestStatus(workOrder, user, 'CONCLUIDA', 'Serviço concluído pela equipe', executionSummary, 'Serviço realizado pela equipe responsável.');
    if (beforeStoredPhoto) this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'FOTO_ADICIONADA', action: 'Foto antes da execução enviada', observation: beforeStoredPhoto.originalName });
    if (afterStoredPhoto) this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'FOTO_ADICIONADA', action: 'Foto depois da execução enviada', observation: afterStoredPhoto.originalName });
    return result;
  }

  reportPending(workOrderId, user, { reason, observation }) {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (user.role !== 'MANUTENCAO' || !canHandleWorkOrder(user, workOrder)) return { forbidden: true };
    if (workOrder.status !== 'EM_EXECUCAO') return { error: 'Inicie a ordem de serviço antes de registrar uma pendência.' };
    const normalizedReason = String(reason || '').trim().toUpperCase();
    const normalizedObservation = String(observation || '').trim();
    if (!PENDING_REASONS.has(normalizedReason)) return { error: 'Selecione um motivo válido.' };
    if (normalizedReason === 'OUTRO' && !normalizedObservation) return { error: 'Descreva o motivo da pendência.' };
    const description = `${pendingReasonLabels[normalizedReason]}${normalizedObservation ? `: ${normalizedObservation}` : ''}`;
    const result = this.repository.registerPending(Number(workOrderId), user.id, description);
    if (result.workOrder) {
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, eventType: 'IMPOSSIBILIDADE_INFORMADA', action: 'Pendência identificada na execução', previousStatus: workOrder.status, newStatus: result.workOrder.status, observation: description });
      this.updateRequestStatus(workOrder, user, 'PENDENTE', 'Pendência informada pela equipe', description, 'A equipe identificou uma pendência no atendimento. A solicitação seguirá em acompanhamento.');
    }
    return result;
  }

  updateRequestStatus(workOrder, user, status, action, observation, publicUpdate) {
    if (workOrder.request_status === status) return;
    this.repository.updateRequestStatus(workOrder.request_id, status);
    this.auditRepository.record({
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      entityType: 'SOLICITACAO',
      userId: user.id,
      eventType: 'STATUS_ALTERADO',
      action,
      previousStatus: workOrder.request_status,
      newStatus: status,
      observation,
      publicUpdate,
    });
  }
}

module.exports = { WorkOrderService, WORK_ORDER_STATUSES, PENDING_REASONS };
