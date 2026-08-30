const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function initializeSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('SOLICITANTE', 'VEREADOR', 'MANUTENCAO', 'ADMINISTRADOR')),
      team_id INTEGER REFERENCES teams(id),
      employee_number TEXT,
      phone TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      service_categories TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocol TEXT NOT NULL UNIQUE,
      requester_user_id INTEGER REFERENCES users(id),
      requester_name TEXT NOT NULL,
      requester_type TEXT NOT NULL CHECK (requester_type IN ('MUNICIPE', 'VEREADOR', 'FUNCIONARIO')),
      phone TEXT NOT NULL,
      requester_email TEXT,
      category TEXT NOT NULL CHECK (category IN ('ESTRADAS', 'LAMPADAS', 'LUMINARIAS')),
      location TEXT NOT NULL,
      neighborhood TEXT NOT NULL,
      reference TEXT NOT NULL,
      description TEXT NOT NULL,
      specific_details TEXT NOT NULL DEFAULT '{}',
      latitude REAL,
      longitude REAL,
      status TEXT NOT NULL DEFAULT 'AGUARDANDO_ANALISE',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
      protocol TEXT NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      assigned_user_id INTEGER REFERENCES users(id),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'PROGRAMADA' CHECK (status IN ('PROGRAMADA', 'ATRIBUIDA', 'EM_EXECUCAO', 'EXECUTADA', 'PENDENCIA_IDENTIFICADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('INICIO', 'EXECUCAO', 'OBSERVACAO')),
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL UNIQUE REFERENCES work_orders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      observation TEXT NOT NULL,
      before_photo_path TEXT,
      after_photo_path TEXT,
      latitude REAL,
      longitude REAL,
      executed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
      image_type TEXT NOT NULL CHECK (image_type IN ('SOLICITACAO', 'ANTES_EXECUCAO', 'DEPOIS_EXECUCAO')),
      storage_path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
      file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('SOLICITACAO', 'ORDEM_SERVICO')),
      user_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      previous_priority TEXT,
      new_priority TEXT,
      observation TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'WHATSAPP')),
      destination TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDENTE_INTEGRACAO',
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requests_protocol ON requests(protocol);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_work_orders_team ON work_orders(team_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_executions_work_order ON work_order_executions(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_request_images_request ON request_images(request_id);
    CREATE INDEX IF NOT EXISTS idx_request_images_work_order ON request_images(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_request ON audit_logs(request_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_work_order ON audit_logs(work_order_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_request ON notification_queue(request_id, created_at);
  `);

  const requestColumns = database.prepare('PRAGMA table_info(requests)').all().map((column) => column.name);
  if (!requestColumns.includes('requester_user_id')) {
    database.exec('ALTER TABLE requests ADD COLUMN requester_user_id INTEGER');
  }
  if (!requestColumns.includes('latitude')) database.exec('ALTER TABLE requests ADD COLUMN latitude REAL');
  if (!requestColumns.includes('longitude')) database.exec('ALTER TABLE requests ADD COLUMN longitude REAL');
  if (!requestColumns.includes('requester_email')) database.exec('ALTER TABLE requests ADD COLUMN requester_email TEXT');

  const userColumns = database.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('employee_number')) database.exec('ALTER TABLE users ADD COLUMN employee_number TEXT');
  if (!userColumns.includes('phone')) database.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('job_title')) database.exec("ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('department')) database.exec("ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('service_categories')) database.exec("ALTER TABLE users ADD COLUMN service_categories TEXT NOT NULL DEFAULT '[]'");
  migrateUserRoles(database);

  const executionColumns = database.prepare('PRAGMA table_info(work_order_executions)').all().map((column) => column.name);
  if (!executionColumns.includes('latitude')) database.exec('ALTER TABLE work_order_executions ADD COLUMN latitude REAL');
  if (!executionColumns.includes('longitude')) database.exec('ALTER TABLE work_order_executions ADD COLUMN longitude REAL');

  migrateLegacyWorkOrders(database);
  migrateWorkOrderStatuses(database);
  migrateLegacyExecutionImages(database);

  database.prepare('INSERT OR IGNORE INTO teams (name, created_at) VALUES (?, ?)').run('Manutenção Urbana', new Date().toISOString());
  ensureSystemAuditUser(database);
}

function ensureSystemAuditUser(database) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO users (
      name, email, password_hash, role, active, created_at, updated_at
    ) VALUES (?, ?, ?, 'SOLICITANTE', 0, ?, ?)
  `).run('Sistema público', 'sistema.publico@zelacity.local', 'login-bloqueado', now, now);
}

function migrateUserRoles(database) {
  const tableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (tableSql.includes("'VEREADOR'")) return;

  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec(`
      BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('SOLICITANTE', 'VEREADOR', 'MANUTENCAO', 'ADMINISTRADOR')),
        team_id INTEGER REFERENCES teams(id),
        employee_number TEXT,
        phone TEXT NOT NULL DEFAULT '',
        job_title TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        service_categories TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users_new (
        id, name, email, password_hash, role, team_id, employee_number, phone,
        job_title, department, service_categories, active, created_at, updated_at
      ) SELECT
        id, name, email, password_hash, role, team_id, employee_number, phone,
        job_title, department, service_categories, active, created_at, updated_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
      COMMIT;
    `);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function migrateLegacyExecutionImages(database) {
  const rows = database.prepare(`
    SELECT work_order_executions.*, work_orders.request_id
    FROM work_order_executions
    JOIN work_orders ON work_orders.id = work_order_executions.work_order_id
    WHERE before_photo_path IS NOT NULL OR after_photo_path IS NOT NULL
  `).all();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO request_images (
      request_id, work_order_id, image_type, storage_path, original_name,
      mime_type, file_size, uploaded_by_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const row of rows) {
    const mimeType = (storagePath) => storagePath.endsWith('.png') ? 'image/png' : storagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    if (row.before_photo_path) insert.run(row.request_id, row.work_order_id, 'ANTES_EXECUCAO', row.before_photo_path, 'Foto antes (registro anterior)', mimeType(row.before_photo_path), row.user_id, row.created_at);
    if (row.after_photo_path) insert.run(row.request_id, row.work_order_id, 'DEPOIS_EXECUCAO', row.after_photo_path, 'Foto depois (registro anterior)', mimeType(row.after_photo_path), row.user_id, row.created_at);
  }
}

function migrateLegacyWorkOrders(database) {
  const columns = database.prepare('PRAGMA table_info(work_orders)').all().map((column) => column.name);
  if (columns.includes('number')) return;

  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec(`
      BEGIN;
      CREATE TABLE work_orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
        protocol TEXT NOT NULL,
        category TEXT NOT NULL,
        location TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        assigned_user_id INTEGER REFERENCES users(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        scheduled_at TEXT,
        status TEXT NOT NULL DEFAULT 'PROGRAMADA' CHECK (status IN ('PROGRAMADA', 'ATRIBUIDA', 'EM_EXECUCAO', 'EXECUTADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO work_orders_new (
        id, number, request_id, protocol, category, location, description, priority,
        team_id, created_by_user_id, status, created_at, updated_at
      )
      SELECT work_orders.id, printf('OS-%s-%05d', strftime('%Y', work_orders.created_at), work_orders.id),
             requests.id, requests.protocol, requests.category, requests.location, requests.description, requests.priority,
             work_orders.team_id, work_orders.created_by_user_id,
             CASE work_orders.status WHEN 'ABERTA' THEN 'PROGRAMADA' WHEN 'EM_EXECUCAO' THEN 'EM_EXECUCAO' ELSE 'CONCLUIDA' END,
             work_orders.created_at, work_orders.updated_at
      FROM work_orders JOIN requests ON requests.id = work_orders.request_id;
      DROP TABLE work_orders;
      ALTER TABLE work_orders_new RENAME TO work_orders;
      CREATE INDEX IF NOT EXISTS idx_work_orders_team ON work_orders(team_id);
      COMMIT;
    `);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function migrateWorkOrderStatuses(database) {
  const tableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'work_orders'").get()?.sql || '';
  if (tableSql.includes('PENDENCIA_IDENTIFICADA')) return;

  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec(`
      BEGIN;
      CREATE TABLE work_orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
        protocol TEXT NOT NULL,
        category TEXT NOT NULL,
        location TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        assigned_user_id INTEGER REFERENCES users(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        scheduled_at TEXT,
        status TEXT NOT NULL DEFAULT 'PROGRAMADA' CHECK (status IN ('PROGRAMADA', 'ATRIBUIDA', 'EM_EXECUCAO', 'EXECUTADA', 'PENDENCIA_IDENTIFICADA', 'CONFERENCIA', 'CONCLUIDA', 'CANCELADA')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO work_orders_new (
        id, number, request_id, protocol, category, location, description, priority,
        team_id, assigned_user_id, created_by_user_id, scheduled_at, status, created_at, updated_at
      ) SELECT
        id, number, request_id, protocol, category, location, description, priority,
        team_id, assigned_user_id, created_by_user_id, scheduled_at, status, created_at, updated_at
      FROM work_orders;
      DROP TABLE work_orders;
      ALTER TABLE work_orders_new RENAME TO work_orders;
      CREATE INDEX IF NOT EXISTS idx_work_orders_team ON work_orders(team_id);
      COMMIT;
    `);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  initializeSchema(database);
  return database;
}

module.exports = { createDatabase };
