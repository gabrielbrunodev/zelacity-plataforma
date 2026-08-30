class AuditRepository {
  constructor(database) {
    this.database = database;
  }

  record({ requestId, workOrderId = null, entityType, userId, action, previousStatus = null, newStatus = null, previousPriority = null, newPriority = null, observation = null, createdAt = new Date().toISOString() }) {
    this.database.prepare(`
      INSERT INTO audit_logs (
        request_id, work_order_id, entity_type, user_id, action, previous_status,
        new_status, previous_priority, new_priority, observation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestId, workOrderId, entityType, userId, action, previousStatus, newStatus, previousPriority, newPriority, observation, createdAt);
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
}

module.exports = { AuditRepository };
