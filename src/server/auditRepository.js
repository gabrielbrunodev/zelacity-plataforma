const EVENT_TYPES = new Set([
  'SOLICITACAO_CRIADA', 'ORDEM_SERVICO_CRIADA', 'STATUS_ALTERADO', 'ATRIBUICAO', 'REDISTRIBUICAO',
  'PRIORIDADE_ALTERADA', 'PRAZO_ALTERADO', 'SERVICO_INICIADO', 'SERVICO_CONCLUIDO',
  'IMPOSSIBILIDADE_INFORMADA', 'FOTO_ADICIONADA', 'OBSERVACAO_ADICIONADA',
  'ATUALIZACAO_PUBLICA', 'PROTOCOLO_1DOC_VINCULADO', 'SOLICITACAO_REABERTA', 'ATUALIZACAO',
]);

class AuditRepository {
  constructor(database) {
    this.database = database;
  }

  record({ requestId, workOrderId = null, entityType, userId, eventType = 'ATUALIZACAO', action, previousStatus = null, newStatus = null, previousPriority = null, newPriority = null, observation = null, publicUpdate = null, createdAt = new Date().toISOString() }) {
    if (!EVENT_TYPES.has(eventType)) throw new Error('Tipo de evento de histórico inválido.');
    this.database.prepare(`
      INSERT INTO audit_logs (
        request_id, work_order_id, entity_type, user_id, event_type, action, previous_status,
        new_status, previous_priority, new_priority, observation, public_update, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestId, workOrderId, entityType, userId, eventType, action, previousStatus, newStatus, previousPriority, newPriority, observation, publicUpdate, createdAt);
  }

  listForRequest(requestId) {
    return this.database.prepare(`
      SELECT audit_logs.*, users.name AS user_name, work_orders.number AS work_order_number
      FROM audit_logs
      JOIN users ON users.id = audit_logs.user_id
      LEFT JOIN work_orders ON work_orders.id = audit_logs.work_order_id
      WHERE audit_logs.request_id = ?
      ORDER BY audit_logs.created_at ASC, audit_logs.id ASC
    `).all(requestId);
  }

  listForWorkOrder(workOrderId) {
    return this.database.prepare(`
      SELECT audit_logs.*, users.name AS user_name, work_orders.number AS work_order_number
      FROM audit_logs
      JOIN users ON users.id = audit_logs.user_id
      JOIN work_orders ON work_orders.id = audit_logs.work_order_id
      WHERE audit_logs.work_order_id = ?
      ORDER BY audit_logs.created_at ASC, audit_logs.id ASC
    `).all(workOrderId);
  }

  findLatestPublicUpdateForRequest(requestId, status) {
    return this.database.prepare(`
      SELECT public_update
      FROM audit_logs
      WHERE request_id = ? AND new_status = ? AND public_update IS NOT NULL AND TRIM(public_update) <> ''
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(requestId, status) || null;
  }

  listPublicForRequest(requestId) {
    return this.database.prepare(`
      SELECT event_type, new_status, public_update, created_at
      FROM audit_logs
      WHERE request_id = ? AND public_update IS NOT NULL AND TRIM(public_update) <> ''
      ORDER BY created_at ASC, id ASC
    `).all(requestId);
  }
}

module.exports = { AuditRepository, EVENT_TYPES };
