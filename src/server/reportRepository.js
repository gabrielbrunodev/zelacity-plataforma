const NON_PENDING_STATUSES = "'CONCLUIDA', 'NAO_REALIZADA', 'CANCELADA'";
const REQUESTS_FROM = 'FROM requests LEFT JOIN work_orders ON work_orders.request_id = requests.id';

class ReportRepository {
  constructor(database) {
    this.database = database;
  }

  requestConditions(filters, dateColumn = 'requests.created_at') {
    const clauses = [];
    const values = [];
    if (filters.startDate) { clauses.push(`${dateColumn} >= ?`); values.push(`${filters.startDate}T00:00:00.000Z`); }
    if (filters.endDate) { clauses.push(`${dateColumn} <= ?`); values.push(`${filters.endDate}T23:59:59.999Z`); }
    if (filters.category) { clauses.push('requests.category = ?'); values.push(filters.category); }
    if (filters.status) { clauses.push('requests.status = ?'); values.push(filters.status); }
    if (filters.source) { clauses.push('requests.source = ?'); values.push(filters.source); }
    if (filters.neighborhood) { clauses.push('requests.neighborhood LIKE ?'); values.push(`%${filters.neighborhood}%`); }
    if (filters.priority) { clauses.push('requests.priority = ?'); values.push(filters.priority); }
    if (filters.teamId) { clauses.push('work_orders.team_id = ?'); values.push(filters.teamId); }
    if (filters.employeeId) { clauses.push('work_orders.assigned_user_id = ?'); values.push(filters.employeeId); }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
  }

  getSummary(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        COALESCE(SUM(CASE WHEN requests.status = 'RECEBIDA' THEN 1 ELSE 0 END), 0) AS received_requests,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed_requests,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending_requests,
        COALESCE(SUM(CASE WHEN requests.deadline_at IS NOT NULL AND datetime(requests.deadline_at) < datetime('now') AND requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS overdue_requests,
        ROUND(AVG(CASE WHEN requests.status = 'CONCLUIDA' THEN
          (julianday(COALESCE((
            SELECT MAX(audit_logs.created_at)
            FROM audit_logs
            WHERE audit_logs.request_id = requests.id AND audit_logs.new_status = 'CONCLUIDA'
          ), requests.updated_at)) - julianday(requests.created_at)) * 24
        END), 2) AS average_attendance_hours
      ${REQUESTS_FROM}
      ${where}
    `).get(...values);
  }

  listByPeriod(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        strftime('%Y-%m', requests.created_at) AS period,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending
      ${REQUESTS_FROM}
      ${where}
      GROUP BY period
      ORDER BY period ASC
    `).all(...values);
  }

  listByCategory(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        requests.category,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending
      ${REQUESTS_FROM}
      ${where}
      GROUP BY requests.category
      ORDER BY total DESC, requests.category ASC
    `).all(...values);
  }

  listByNeighborhood(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        requests.neighborhood,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending
      ${REQUESTS_FROM}
      ${where}
      GROUP BY requests.neighborhood
      ORDER BY total DESC, requests.neighborhood ASC
    `).all(...values);
  }

  listBySource(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT requests.source, COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending
      ${REQUESTS_FROM}
      ${where}
      GROUP BY requests.source
      ORDER BY total DESC, requests.source ASC
    `).all(...values);
  }

  listByEmployee(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        COALESCE(users.name, 'Não atribuído') AS employee,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending
      ${REQUESTS_FROM}
      LEFT JOIN users ON users.id = work_orders.assigned_user_id
      ${where}
      GROUP BY users.id, users.name
      ORDER BY total DESC, employee ASC
    `).all(...values);
  }

  listByTeam(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        COALESCE(teams.name, 'Sem equipe') AS team,
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending
      ${REQUESTS_FROM}
      LEFT JOIN teams ON teams.id = work_orders.team_id
      ${where}
      GROUP BY teams.id, teams.name
      ORDER BY total DESC, team ASC
    `).all(...values);
  }

  listServicesByTeam(filters) {
    const { where, values } = this.requestConditions(filters, 'work_order_executions.executed_at');
    return this.database.prepare(`
      SELECT
        teams.name AS team,
        COUNT(DISTINCT work_order_executions.work_order_id) AS executed_services
      FROM work_order_executions
      JOIN work_orders ON work_orders.id = work_order_executions.work_order_id
      JOIN teams ON teams.id = work_orders.team_id
      JOIN requests ON requests.id = work_orders.request_id
      ${where}
      GROUP BY teams.id, teams.name
      ORDER BY executed_services DESC, teams.name ASC
    `).all(...values);
  }

  listRequests(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        requests.protocol,
        requests.source,
        requests.created_at,
        requests.category,
        requests.location,
        requests.neighborhood,
        requests.status,
        requests.priority,
        requests.deadline_at,
        CASE
          WHEN requests.deadline_at IS NULL THEN 'SEM_PRAZO'
          WHEN requests.status IN (${NON_PENDING_STATUSES}) THEN 'ENCERRADA'
          WHEN datetime(requests.deadline_at) < datetime('now') THEN 'ATRASADA'
          WHEN datetime(requests.deadline_at) <= datetime('now', '+2 days') THEN 'PROXIMA'
          ELSE 'NO_PRAZO'
        END AS deadline_state,
        work_orders.number AS work_order_number,
        work_orders.status AS work_order_status,
        teams.name AS team,
        users.name AS employee,
        completion.completed_at,
        ROUND(CASE WHEN requests.status = 'CONCLUIDA' THEN
          (julianday(COALESCE(completion.completed_at, requests.updated_at)) - julianday(requests.created_at)) * 24
        END, 2) AS attendance_hours
      ${REQUESTS_FROM}
      LEFT JOIN teams ON teams.id = work_orders.team_id
      LEFT JOIN users ON users.id = work_orders.assigned_user_id
      LEFT JOIN (
        SELECT request_id, MAX(created_at) AS completed_at
        FROM audit_logs
        WHERE new_status = 'CONCLUIDA'
        GROUP BY request_id
      ) AS completion ON completion.request_id = requests.id
      ${where}
      ORDER BY requests.created_at DESC
      LIMIT 5000
    `).all(...values);
  }
}

module.exports = { ReportRepository };
