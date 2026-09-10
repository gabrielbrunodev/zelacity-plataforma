class CategoryRepository {
  constructor(database) {
    this.database = database;
  }

  list({ includeInactive = false } = {}) {
    const condition = includeInactive ? '' : 'WHERE active = 1';
    return this.database.prepare(`
      SELECT code, name, active, default_deadline_days, created_at, updated_at
      FROM service_categories
      ${condition}
      ORDER BY name COLLATE NOCASE
    `).all();
  }

  findByCode(code) {
    return this.database.prepare('SELECT code, name, active, default_deadline_days, created_at, updated_at FROM service_categories WHERE code = ?').get(code) || null;
  }

  create({ code, name, defaultDeadlineDays = null }) {
    const now = new Date().toISOString();
    this.database.prepare('INSERT INTO service_categories (code, name, active, default_deadline_days, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').run(code, name, defaultDeadlineDays, now, now);
    return this.findByCode(code);
  }

  update(code, { name, active, defaultDeadlineDays }) {
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
    if (defaultDeadlineDays !== undefined) { fields.push('default_deadline_days = ?'); values.push(defaultDeadlineDays); }
    if (!fields.length) return this.findByCode(code);
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), code);
    this.database.prepare(`UPDATE service_categories SET ${fields.join(', ')} WHERE code = ?`).run(...values);
    return this.findByCode(code);
  }
}

module.exports = { CategoryRepository };
