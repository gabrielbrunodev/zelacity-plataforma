class RequestRepository {
  constructor(database) {
    this.database = database;
  }

  create(requestData, requesterUserId) {
    const year = new Date().getFullYear();
    const prefix = `SOL-${year}-`;
    const now = new Date().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const sequenceRow = this.database
        .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(protocol, 10) AS INTEGER)), 0) AS last_sequence FROM requests WHERE protocol LIKE ?")
        .get(`${prefix}%`);
      const nextSequence = sequenceRow.last_sequence + 1;
      const protocol = `${prefix}${String(nextSequence).padStart(5, '0')}`;

      const result = this.database
        .prepare(`
          INSERT INTO requests (
            protocol, requester_user_id, requester_name, requester_type, phone, requester_email, category,
            location, neighborhood, reference, description, specific_details, latitude, longitude,
            status, priority, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AGUARDANDO_ANALISE', 'NORMAL', ?, ?)
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
          now,
          now,
        );

      this.database.exec('COMMIT');
      return {
        id: Number(result.lastInsertRowid),
        protocol,
        requesterUserId,
        status: 'AGUARDANDO_ANALISE',
        priority: 'NORMAL',
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
             teams.name AS responsible_name, work_orders.id AS work_order_id, work_orders.status AS work_order_status
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
             requests.updated_at, work_orders.number AS work_order_number,
             work_orders.status AS work_order_status
      FROM requests
      LEFT JOIN work_orders ON work_orders.request_id = requests.id
      WHERE requests.requester_user_id = ?
      ORDER BY requests.created_at DESC
    `).all(userId);
  }

  listForAdministrator(filters) {
    const clauses = [];
    const values = [];
    if (filters.category) { clauses.push('requests.category = ?'); values.push(filters.category); }
    if (filters.status) { clauses.push('requests.status = ?'); values.push(filters.status); }
    if (filters.priority) { clauses.push('requests.priority = ?'); values.push(filters.priority); }
    if (filters.neighborhood) { clauses.push('requests.neighborhood LIKE ?'); values.push(`%${filters.neighborhood}%`); }
    if (filters.protocol) { clauses.push('requests.protocol LIKE ?'); values.push(`%${filters.protocol}%`); }
    if (filters.startDate) { clauses.push('requests.created_at >= ?'); values.push(`${filters.startDate}T00:00:00.000Z`); }
    if (filters.endDate) { clauses.push('requests.created_at <= ?'); values.push(`${filters.endDate}T23:59:59.999Z`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    return this.database.prepare(`
      SELECT requests.*, teams.name AS responsible_name, work_orders.id AS work_order_id
      FROM requests
      LEFT JOIN work_orders ON work_orders.request_id = requests.id
      LEFT JOIN teams ON teams.id = work_orders.team_id
      ${where}
      ORDER BY requests.created_at DESC
      LIMIT 250
    `).all(...values);
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

  getDashboardStatistics() {
    return this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('RECEBIDA', 'AGUARDANDO_ANALISE') THEN 1 ELSE 0 END) AS awaiting_analysis,
        SUM(CASE WHEN status = 'APROVADA' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'PROGRAMADA' THEN 1 ELSE 0 END) AS scheduled,
        SUM(CASE WHEN status = 'EM_EXECUCAO' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'CONCLUIDA' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'INDEFERIDA' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN status = 'CANCELADA' THEN 1 ELSE 0 END) AS cancelled
      FROM requests
    `).get();
  }

  updateManagement(protocol, { status, priority }) {
    const updates = [];
    const values = [];
    if (status) { updates.push('status = ?'); values.push(status); }
    if (priority) { updates.push('priority = ?'); values.push(priority); }
    if (!updates.length) return this.findByProtocol(protocol);
    updates.push('updated_at = ?');
    values.push(new Date().toISOString(), protocol);
    this.database.prepare(`UPDATE requests SET ${updates.join(', ')} WHERE protocol = ?`).run(...values);
    return this.findByProtocol(protocol);
  }
}

module.exports = { RequestRepository };
