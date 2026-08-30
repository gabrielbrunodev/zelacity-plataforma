const UPDATE_TYPES = new Set(['INICIO', 'EXECUCAO', 'OBSERVACAO']);
const WORK_ORDER_STATUSES = new Set(['PROGRAMADA', 'ATRIBUIDA', 'EM_EXECUCAO', 'EXECUTADA', 'PENDENCIA_IDENTIFICADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA']);
const PENDING_REASONS = new Set(['FALTA_MATERIAL', 'NECESSIDADE_EQUIPAMENTO', 'LOCAL_NAO_ENCONTRADO', 'PROBLEMA_DIFERENTE', 'VISTORIA_TECNICA', 'CONDICOES_CLIMATICAS', 'AREA_INACESSIVEL', 'OUTRA_EQUIPE', 'OUTRO']);
const NUMBER_PATTERN = /^OS-\d{4}-\d{5,}$/;
const { parseCoordinates } = require('./coordinates');

const statusLabels = { PROGRAMADA: 'Programada', ATRIBUIDA: 'Atribuída', EM_EXECUCAO: 'Em execução', EXECUTADA: 'Executada', PENDENCIA_IDENTIFICADA: 'Pendência identificada', CONFERENCIA: 'Conferência', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' };
const pendingReasonLabels = { FALTA_MATERIAL: 'Falta de material', NECESSIDADE_EQUIPAMENTO: 'Necessidade de máquina ou equipamento', LOCAL_NAO_ENCONTRADO: 'Endereço ou local não encontrado', PROBLEMA_DIFERENTE: 'Problema diferente do informado', VISTORIA_TECNICA: 'Necessidade de vistoria técnica', CONDICOES_CLIMATICAS: 'Condições climáticas', AREA_INACESSIVEL: 'Área inacessível', OUTRA_EQUIPE: 'Serviço depende de outra equipe', OUTRO: 'Outro' };

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

class WorkOrderService {
  constructor(repository, photoStorage, auditRepository) {
    this.repository = repository;
    this.photoStorage = photoStorage;
    this.auditRepository = auditRepository;
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
    if (!normalizedAssigneeId) return { error: 'Selecione o responsável pela ordem de serviço.' };
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
      action: 'OS criada',
      newStatus: workOrder.status,
      observation: `${workOrder.number} criada para a solicitação ${workOrder.protocol}.`,
    });
    if (workOrder.assigned_user_id) {
      this.auditRepository.record({
        requestId: workOrder.request_id,
        workOrderId: workOrder.id,
        entityType: 'ORDEM_SERVICO',
        userId: administratorId,
        action: `OS atribuída à ${workOrder.team_name}`,
        newStatus: workOrder.status,
        observation: workOrder.assigned_user_name ? `Responsável: ${workOrder.assigned_user_name}.` : null,
      });
    }
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
    if (user.role === 'MANUTENCAO' && workOrder.team_id !== user.teamId) return { forbidden: true };
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
        action: 'Data programada da OS alterada',
        observation: `Nova programação: ${new Date(scheduledAt).toLocaleString('pt-BR')}.`,
      });
    }
    return { workOrder };
  }

  registerUpdate(workOrderId, user, { type, description }) {
    const normalizedType = String(type || '').trim().toUpperCase();
    const normalizedDescription = String(description || '').trim();
    if (!UPDATE_TYPES.has(normalizedType)) return { error: 'Tipo de atualização inválido.' };
    if (!normalizedDescription) return { error: 'Descreva a atualização.' };
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (user.role === 'MANUTENCAO' && workOrder.team_id !== user.teamId) return { forbidden: true };
    if (normalizedType === 'INICIO') return this.start(workOrderId, user, normalizedDescription);
    if (normalizedType === 'EXECUCAO') return { error: 'Use a finalização do serviço para registrar execução, fotos e horário.' };
    const result = this.repository.addUpdate(Number(workOrderId), user.id, normalizedType, normalizedDescription);
    if (result.workOrder) {
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, action: 'Observação registrada na OS', observation: normalizedDescription });
    }
    return result;
  }

  start(workOrderId, user, description = 'Serviço iniciado pela equipe de manutenção.') {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (user.role === 'MANUTENCAO' && workOrder.team_id !== user.teamId) return { forbidden: true };
    if (!['PROGRAMADA', 'ATRIBUIDA'].includes(workOrder.status)) return { error: 'Esta ordem de serviço não pode ser iniciada no status atual.' };
    const result = this.repository.addUpdate(Number(workOrderId), user.id, 'INICIO', description);
    if (result.workOrder) {
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, action: 'Serviço iniciado', previousStatus: workOrder.status, newStatus: result.workOrder.status, observation: description });
    }
    return result;
  }

  complete(workOrderId, user, { observation, executedAt, beforePhoto, afterPhoto, latitude, longitude }) {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (user.role === 'MANUTENCAO' && workOrder.team_id !== user.teamId) return { forbidden: true };
    if (workOrder.status !== 'EM_EXECUCAO') return { error: 'A ordem de serviço precisa estar em execução para ser finalizada.' };
    const normalizedObservation = String(observation || '').trim();
    const normalizedExecutedAt = toIsoDate(executedAt);
    if (!normalizedObservation) return { error: 'Informe uma observação sobre a execução.' };
    if (!normalizedExecutedAt) return { error: 'Informe a data e o horário da execução.' };
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
        beforePhoto: beforeStoredPhoto,
        afterPhoto: afterStoredPhoto,
        latitude: coordinateValidation.coordinates?.latitude ?? null,
        longitude: coordinateValidation.coordinates?.longitude ?? null,
        executedAt: normalizedExecutedAt,
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
    this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, action: 'Serviço executado', previousStatus: workOrder.status, newStatus: result.workOrder.status, observation: normalizedObservation });
    if (beforeStoredPhoto) this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, action: 'Foto antes da execução enviada', observation: beforeStoredPhoto.originalName });
    if (afterStoredPhoto) this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, action: 'Foto depois da execução enviada', observation: afterStoredPhoto.originalName });
    return result;
  }

  reportPending(workOrderId, user, { reason, observation }) {
    const workOrder = this.repository.findById(Number(workOrderId));
    if (!workOrder) return { notFound: true };
    if (user.role !== 'MANUTENCAO' || workOrder.team_id !== user.teamId) return { forbidden: true };
    if (workOrder.status !== 'EM_EXECUCAO') return { error: 'Inicie a ordem de serviço antes de registrar uma pendência.' };
    const normalizedReason = String(reason || '').trim().toUpperCase();
    const normalizedObservation = String(observation || '').trim();
    if (!PENDING_REASONS.has(normalizedReason)) return { error: 'Selecione um motivo válido.' };
    if (normalizedReason === 'OUTRO' && !normalizedObservation) return { error: 'Descreva o motivo da pendência.' };
    const description = `${pendingReasonLabels[normalizedReason]}${normalizedObservation ? `: ${normalizedObservation}` : ''}`;
    const result = this.repository.registerPending(Number(workOrderId), user.id, description);
    if (result.workOrder) {
      this.auditRepository.record({ requestId: workOrder.request_id, workOrderId: workOrder.id, entityType: 'ORDEM_SERVICO', userId: user.id, action: 'Pendência identificada na execução', previousStatus: workOrder.status, newStatus: result.workOrder.status, observation: description });
    }
    return result;
  }
}

module.exports = { WorkOrderService, WORK_ORDER_STATUSES, PENDING_REASONS };
