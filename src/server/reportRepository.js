const NON_PENDING_STATUSES = "'CONCLUIDA', 'INDEFERIDA', 'CANCELADA'";

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
    if (filters.neighborhood) { clauses.push('requests.neighborhood LIKE ?'); values.push(`%${filters.neighborhood}%`); }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
  }

  getSummary(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        COUNT(*) AS total_requests,
        COALESCE(SUM(CASE WHEN requests.status = 'CONCLUIDA' THEN 1 ELSE 0 END), 0) AS completed_requests,
        COALESCE(SUM(CASE WHEN requests.status NOT IN (${NON_PENDING_STATUSES}) THEN 1 ELSE 0 END), 0) AS pending_requests,
        ROUND(AVG(CASE WHEN requests.status = 'CONCLUIDA' THEN
          (julianday(COALESCE((
            SELECT MAX(audit_logs.created_at)
            FROM audit_logs
            WHERE audit_logs.request_id = requests.id AND audit_logs.new_status = 'CONCLUIDA'
          ), requests.updated_at)) - julianday(requests.created_at)) * 24
        END), 2) AS average_attendance_hours
      FROM requests
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
      FROM requests
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
      FROM requests
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
      FROM requests
      ${where}
      GROUP BY requests.neighborhood
      ORDER BY total DESC, requests.neighborhood COLLATE NOCASE ASC
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
      ORDER BY executed_services DESC, teams.name COLLATE NOCASE ASC
    `).all(...values);
  }

  listRequests(filters) {
    const { where, values } = this.requestConditions(filters);
    return this.database.prepare(`
      SELECT
        requests.protocol,
        requests.created_at,
        requests.category,
        requests.location,
        requests.neighborhood,
        requests.status,
        requests.priority,
        work_orders.number AS work_order_number,
        work_orders.status AS work_order_status,
        teams.name AS team,
        completion.completed_at,
        ROUND(CASE WHEN requests.status = 'CONCLUIDA' THEN
          (julianday(COALESCE(completion.completed_at, requests.updated_at)) - julianday(requests.created_at)) * 24
        END, 2) AS attendance_hours
      FROM requests
      LEFT JOIN work_orders ON work_orders.request_id = requests.id
      LEFT JOIN teams ON teams.id = work_orders.team_id
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
