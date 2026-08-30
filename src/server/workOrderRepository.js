class WorkOrderRepository {
  constructor(database) {
    this.database = database;
  }

  listTeams() {
    return this.database.prepare('SELECT id, name FROM teams ORDER BY name').all();
  }

  createTeam(name) {
    const result = this.database.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run(name, new Date().toISOString());
    return this.database.prepare('SELECT id, name FROM teams WHERE id = ?').get(Number(result.lastInsertRowid));
  }

  findTeamMember(teamId, userId) {
    return this.database.prepare("SELECT id, name, service_categories FROM users WHERE id = ? AND team_id = ? AND role = 'MANUTENCAO' AND active = 1").get(userId, teamId) || null;
  }

  canHandleCategory(member, category) {
    try {
      const categories = JSON.parse(member.service_categories || '[]');
      return !categories.length || categories.includes(category);
    } catch {
      return true;
    }
  }

  createForRequest(protocol, { teamId, assignedUserId, scheduledAt }, createdByUserId) {
    const request = this.database.prepare('SELECT * FROM requests WHERE protocol = ?').get(protocol);
    if (!request) return { notFound: true };
    if (request.status !== 'APROVADA') return { error: 'A solicitação precisa estar aprovada para gerar uma ordem de serviço.' };
    if (!this.database.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) return { teamNotFound: true };
    const assignee = assignedUserId ? this.findTeamMember(teamId, assignedUserId) : null;
    if (assignedUserId && !assignee) return { assigneeNotFound: true };
    if (assignee && !this.canHandleCategory(assignee, request.category)) return { assigneeCategoryMismatch: true };

    const year = new Date().getFullYear();
    const prefix = `OS-${year}-`;
    const now = new Date().toISOString();
    const status = assignedUserId ? 'ATRIBUIDA' : 'PROGRAMADA';

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(number, 10) AS INTEGER)), 0) AS last_sequence FROM work_orders WHERE number LIKE ?").get(`${prefix}%`);
      const number = `${prefix}${String(row.last_sequence + 1).padStart(5, '0')}`;
      const result = this.database.prepare(`
        INSERT INTO work_orders (
          number, request_id, protocol, category, location, description, priority,
          team_id, assigned_user_id, created_by_user_id, scheduled_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(number, request.id, request.protocol, request.category, request.location, request.description, request.priority, teamId, assignedUserId || null, createdByUserId, scheduledAt || null, status, now, now);
      this.database.exec('COMMIT');
      return { workOrder: this.findById(Number(result.lastInsertRowid)) };
    } catch (error) {
      this.database.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE')) return { error: 'Já existe uma ordem de serviço para esta solicitação.' };
      throw error;
    }
  }

  findById(id) {
    return this.database.prepare(`
      SELECT work_orders.*, teams.name AS team_name, users.name AS assigned_user_name, requests.neighborhood,
             requests.reference, requests.latitude AS request_latitude, requests.longitude AS request_longitude,
             requests.created_at AS request_created_at,
             work_order_executions.observation AS execution_observation, work_order_executions.before_photo_path,
             work_order_executions.after_photo_path, work_order_executions.latitude AS execution_latitude,
             work_order_executions.longitude AS execution_longitude, work_order_executions.executed_at
      FROM work_orders
      JOIN teams ON teams.id = work_orders.team_id
      LEFT JOIN users ON users.id = work_orders.assigned_user_id
      JOIN requests ON requests.id = work_orders.request_id
      LEFT JOIN work_order_executions ON work_order_executions.work_order_id = work_orders.id
      WHERE work_orders.id = ?
    `).get(id) || null;
  }

  findByNumber(number) {
    return this.database.prepare(`
      SELECT work_orders.*, teams.name AS team_name, users.name AS assigned_user_name, requests.neighborhood,
             requests.reference, requests.latitude AS request_latitude, requests.longitude AS request_longitude,
             requests.created_at AS request_created_at,
             work_order_executions.observation AS execution_observation, work_order_executions.before_photo_path,
             work_order_executions.after_photo_path, work_order_executions.latitude AS execution_latitude,
             work_order_executions.longitude AS execution_longitude, work_order_executions.executed_at
      FROM work_orders
      JOIN teams ON teams.id = work_orders.team_id
      LEFT JOIN users ON users.id = work_orders.assigned_user_id
      JOIN requests ON requests.id = work_orders.request_id
      LEFT JOIN work_order_executions ON work_order_executions.work_order_id = work_orders.id
      WHERE work_orders.number = ?
    `).get(number) || null;
  }

  listForUser(user) {
    const condition = user.role === 'ADMINISTRADOR' ? '' : 'WHERE work_orders.team_id = ?';
    const statement = this.database.prepare(`
      SELECT work_orders.*, teams.name AS team_name, users.name AS assigned_user_name, requests.neighborhood,
             requests.reference, requests.latitude AS request_latitude, requests.longitude AS request_longitude,
             requests.created_at AS request_created_at,
             work_order_executions.observation AS execution_observation, work_order_executions.before_photo_path,
             work_order_executions.after_photo_path, work_order_executions.latitude AS execution_latitude,
             work_order_executions.longitude AS execution_longitude, work_order_executions.executed_at
      FROM work_orders
      JOIN teams ON teams.id = work_orders.team_id
      LEFT JOIN users ON users.id = work_orders.assigned_user_id
      JOIN requests ON requests.id = work_orders.request_id
      LEFT JOIN work_order_executions ON work_order_executions.work_order_id = work_orders.id
      ${condition}
      ORDER BY COALESCE(work_orders.scheduled_at, work_orders.created_at) DESC
    `);
    return user.role === 'ADMINISTRADOR' ? statement.all() : statement.all(user.teamId);
  }

  updateManagement(number, changes) {
    const fields = [];
    const values = [];
    if (changes.teamId) { fields.push('team_id = ?'); values.push(changes.teamId); }
    if (changes.assignedUserId !== undefined) { fields.push('assigned_user_id = ?'); values.push(changes.assignedUserId); }
    if (changes.scheduledAt !== undefined) { fields.push('scheduled_at = ?'); values.push(changes.scheduledAt); }
    if (changes.status) { fields.push('status = ?'); values.push(changes.status); }
    if (!fields.length) return this.findByNumber(number);
    fields.push('updated_at = ?'); values.push(new Date().toISOString(), number);
    this.database.prepare(`UPDATE work_orders SET ${fields.join(', ')} WHERE number = ?`).run(...values);
    return this.findByNumber(number);
  }

  addUpdate(workOrderId, userId, type, description) {
    const workOrder = this.findById(workOrderId);
    if (!workOrder) return { notFound: true };
    const now = new Date().toISOString();
    const statusByUpdate = { INICIO: 'EM_EXECUCAO', EXECUCAO: 'EXECUTADA' };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('INSERT INTO work_order_updates (work_order_id, user_id, type, description, created_at) VALUES (?, ?, ?, ?, ?)').run(workOrderId, userId, type, description, now);
      const status = statusByUpdate[type];
      if (status) this.database.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, workOrderId);
      else this.database.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now, workOrderId);
      this.database.exec('COMMIT');
      return { workOrder: this.findById(workOrderId) };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  registerPending(workOrderId, userId, description) {
    const workOrder = this.findById(workOrderId);
    if (!workOrder) return { notFound: true };
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('INSERT INTO work_order_updates (work_order_id, user_id, type, description, created_at) VALUES (?, ?, ?, ?, ?)').run(workOrderId, userId, 'OBSERVACAO', description, now);
      this.database.prepare("UPDATE work_orders SET status = 'PENDENCIA_IDENTIFICADA', updated_at = ? WHERE id = ?").run(now, workOrderId);
      this.database.exec('COMMIT');
      return { workOrder: this.findById(workOrderId) };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  completeExecution(workOrderId, userId, { observation, beforePhoto, afterPhoto, latitude, longitude, executedAt }) {
    const workOrder = this.findById(workOrderId);
    if (!workOrder) return { notFound: true };
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO work_order_executions (
          work_order_id, user_id, observation, before_photo_path, after_photo_path, latitude, longitude, executed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(workOrderId, userId, observation, beforePhoto?.storagePath || null, afterPhoto?.storagePath || null, latitude, longitude, executedAt, now);
      const insertImage = this.database.prepare(`
        INSERT INTO request_images (
          request_id, work_order_id, image_type, storage_path, original_name,
          mime_type, file_size, uploaded_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      if (beforePhoto) insertImage.run(workOrder.request_id, workOrderId, 'ANTES_EXECUCAO', beforePhoto.storagePath, beforePhoto.originalName, beforePhoto.mimeType, beforePhoto.size, userId, now);
      if (afterPhoto) insertImage.run(workOrder.request_id, workOrderId, 'DEPOIS_EXECUCAO', afterPhoto.storagePath, afterPhoto.originalName, afterPhoto.mimeType, afterPhoto.size, userId, now);
      this.database.prepare('INSERT INTO work_order_updates (work_order_id, user_id, type, description, created_at) VALUES (?, ?, ?, ?, ?)').run(workOrderId, userId, 'EXECUCAO', observation, now);
      this.database.prepare("UPDATE work_orders SET status = 'EXECUTADA', updated_at = ? WHERE id = ?").run(now, workOrderId);
      this.database.exec('COMMIT');
      return { workOrder: this.findById(workOrderId) };
    } catch (error) {
      this.database.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE')) return { error: 'A execução desta ordem de serviço já foi finalizada.' };
      throw error;
    }
  }
}

module.exports = { WorkOrderRepository };
