class RequestRepository {
  constructor(database) {
    this.database = database;
  }

  create(requestData, requesterUserId, createdByUserId = null) {
    const year = new Date().getFullYear();
    const prefix = `${year}-`;
    const now = new Date().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const sequenceRow = this.database
        .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(protocol, 6) AS INTEGER)), 0) AS last_sequence FROM requests WHERE protocol LIKE ?")
        .get(`${prefix}%`);
      const nextSequence = sequenceRow.last_sequence + 1;
      const protocol = `${prefix}${String(nextSequence).padStart(5, '0')}`;

      const result = this.database
        .prepare(`
          INSERT INTO requests (
            protocol, requester_user_id, requester_name, requester_type, phone, requester_email, category,
            location, neighborhood, reference, description, specific_details, latitude, longitude,
            source, external_protocol, created_by_user_id, received_at, deadline_at, status, priority, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEBIDA', ?, ?, ?)
        `)
        .run(
          protocol,
          requesterUserId,
          requestData.name,
          requestData.requesterType,
          requestData.phone,
          requestData.email || null,
          requestData.serviceType,
          requestData.location,
          requestData.neighborhood,
          requestData.reference,
          requestData.description,
          JSON.stringify(requestData.specificDetails),
          requestData.latitude,
          requestData.longitude,
          requestData.source || 'MUNICIPE',
          requestData.externalProtocol || null,
          createdByUserId,
          requestData.receivedAt || null,
          requestData.deadlineAt || null,
          requestData.priority || 'NORMAL',
          now,
          now,
        );

      this.database.exec('COMMIT');
      return {
        id: Number(result.lastInsertRowid),
        protocol,
        requesterUserId,
        status: 'RECEBIDA',
        priority: requestData.priority || 'NORMAL',
        createdAt: now,
        updatedAt: now,
        ...requestData,
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  findByProtocol(protocol) {
    return this.database.prepare(`
      SELECT requests.*, users.name AS account_name, users.email AS account_email,
             teams.name AS responsible_name, work_orders.id AS work_order_id, work_orders.number AS work_order_number, work_orders.status AS work_order_status,
             CAST(MAX(0, julianday('now') - julianday(requests.created_at)) AS INTEGER) AS open_days,
             CASE
               WHEN requests.deadline_at IS NULL THEN 'SEM_PRAZO'
               WHEN requests.status IN ('CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA') THEN 'ENCERRADA'
               WHEN datetime(requests.deadline_at) < datetime('now') THEN 'ATRASADA'
               WHEN datetime(requests.deadline_at) <= datetime('now', '+2 days') THEN 'PROXIMA'
               ELSE 'NO_PRAZO'
             END AS deadline_state
      FROM requests
      LEFT JOIN users ON users.id = requests.requester_user_id
      LEFT JOIN work_orders ON work_orders.request_id = requests.id
      LEFT JOIN teams ON teams.id = work_orders.team_id
      WHERE requests.protocol = ?
    `).get(protocol) || null;
  }

  removeById(id) {
    this.database.prepare('DELETE FROM requests WHERE id = ?').run(id);
  }

  getPublicAuditUserId() {
    const systemUser = this.database.prepare("SELECT id FROM users WHERE email = 'sistema.publico@zelacity.local' LIMIT 1").get();
    if (!systemUser) throw new Error('O usuário interno de auditoria não está disponível.');
    return systemUser.id;
  }

  listAll() {
    return this.listForAdministrator({});
  }

  listForRequesterUserId(userId) {
    return this.database.prepare(`
      SELECT requests.protocol, requests.category, requests.location, requests.neighborhood,
             requests.reference, requests.status, requests.priority, requests.created_at,
             requests.updated_at, requests.source, requests.external_protocol, work_orders.number AS work_order_number,
             work_orders.status AS work_order_status
      FROM requests
      LEFT JOIN work_orders ON work_orders.request_id = requests.id
      WHERE requests.requester_user_id = ?
      ORDER BY requests.created_at DESC
    `).all(userId);
  }

  listForAdministrator(filters) {
    const { clauses, values } = this.administratorFilterConditions(filters);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    return this.database.prepare(`
      SELECT requests.*, teams.name AS responsible_name, work_orders.id AS work_order_id,
             work_orders.team_id, work_orders.assigned_user_id, users.name AS assigned_user_name,
             CAST(MAX(0, julianday('now') - julianday(requests.created_at)) AS INTEGER) AS open_days,
             CASE
               WHEN requests.deadline_at IS NULL THEN 'SEM_PRAZO'
               WHEN requests.status IN ('CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA') THEN 'ENCERRADA'
               WHEN datetime(requests.deadline_at) < datetime('now') THEN 'ATRASADA'
               WHEN datetime(requests.deadline_at) <= datetime('now', '+2 days') THEN 'PROXIMA'
               ELSE 'NO_PRAZO'
             END AS deadline_state
      FROM requests
      LEFT JOIN work_orders ON work_orders.request_id = requests.id
      LEFT JOIN teams ON teams.id = work_orders.team_id
      LEFT JOIN users ON users.id = work_orders.assigned_user_id
      ${where}
      ORDER BY requests.created_at DESC
      LIMIT 250
    `).all(...values);
  }

  administratorFilterConditions(filters = {}) {
    const clauses = [];
    const values = [];
    if (filters.category) { clauses.push('requests.category = ?'); values.push(filters.category); }
    if (filters.status) { clauses.push('requests.status = ?'); values.push(filters.status); }
    if (filters.priority) { clauses.push('requests.priority = ?'); values.push(filters.priority); }
    if (filters.neighborhood) { clauses.push('requests.neighborhood LIKE ?'); values.push(`%${filters.neighborhood}%`); }
    if (filters.protocol) {
      clauses.push('(requests.protocol LIKE ? OR requests.external_protocol LIKE ?)');
      values.push(`%${filters.protocol}%`, `%${filters.protocol}%`);
    }
    if (filters.source) { clauses.push('requests.source = ?'); values.push(filters.source); }
    if (filters.teamId) { clauses.push('work_orders.team_id = ?'); values.push(Number(filters.teamId)); }
    if (filters.employeeId) { clauses.push('work_orders.assigned_user_id = ?'); values.push(Number(filters.employeeId)); }
    if (filters.startDate) { clauses.push('requests.created_at >= ?'); values.push(`${filters.startDate}T00:00:00.000Z`); }
    if (filters.endDate) { clauses.push('requests.created_at <= ?'); values.push(`${filters.endDate}T23:59:59.999Z`); }
    return { clauses, values };
  }

  listForMap({ category = '', status = '' } = {}) {
    const clauses = ['requests.latitude IS NOT NULL', 'requests.longitude IS NOT NULL'];
    const values = [];
    if (category) { clauses.push('requests.category = ?'); values.push(category); }
    if (status) { clauses.push('requests.status = ?'); values.push(status); }
    return this.database.prepare(`
      SELECT requests.protocol, requests.category, requests.location, requests.neighborhood,
             requests.status, requests.priority, requests.latitude, requests.longitude
      FROM requests
      WHERE ${clauses.join(' AND ')}
      ORDER BY requests.updated_at DESC
      LIMIT 500
    `).all(...values);
  }

  getDashboardStatistics(filters = {}) {
    const { clauses, values } = this.administratorFilterConditions(filters);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const summary = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'RECEBIDA' THEN 1 ELSE 0 END), 0) AS received,
        COALESCE(SUM(CASE WHEN requests.status = 'PENDENTE' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN requests.status = 'EM_ATENDIMENTO' THEN 1 ELSE 0 END), 0) AS in_progress,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.deadline_at IS NOT NULL AND datetime(requests.deadline_at) < datetime('now') AND requests.status NOT IN ('CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA') THEN 1 ELSE 0 END), 0) AS overdue
      FROM requests LEFT JOIN work_orders ON work_orders.request_id = requests.id
      ${where}
    `).get(...values);
    const byCategory = this.database.prepare(`SELECT requests.category AS key, COUNT(*) AS total FROM requests LEFT JOIN work_orders ON work_orders.request_id = requests.id ${where} GROUP BY requests.category ORDER BY total DESC, key`).all(...values);
    const bySource = this.database.prepare(`SELECT requests.source AS key, COUNT(*) AS total FROM requests LEFT JOIN work_orders ON work_orders.request_id = requests.id ${where} GROUP BY requests.source ORDER BY total DESC, key`).all(...values);
    return { ...summary, byCategory, bySource };
  }

  updateManagement(protocol, { status, priority, deadlineAt, touch = false }) {
    const updates = [];
    const values = [];
    if (status) { updates.push('status = ?'); values.push(status); }
    if (priority) { updates.push('priority = ?'); values.push(priority); }
    if (deadlineAt !== undefined) { updates.push('deadline_at = ?'); values.push(deadlineAt); }
    if (!updates.length && !touch) return this.findByProtocol(protocol);
    updates.push('updated_at = ?');
    values.push(new Date().toISOString(), protocol);
    this.database.prepare(`UPDATE requests SET ${updates.join(', ')} WHERE protocol = ?`).run(...values);
    return this.findByProtocol(protocol);
  }

  updateExternalProtocol(protocol, externalProtocol) {
    this.database.prepare('UPDATE requests SET external_protocol = ?, updated_at = ? WHERE protocol = ?').run(externalProtocol || null, new Date().toISOString(), protocol);
    return this.findByProtocol(protocol);
  }
}

module.exports = { RequestRepository };
