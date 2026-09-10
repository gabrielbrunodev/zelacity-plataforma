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

    CREATE TABLE IF NOT EXISTS service_categories (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      default_deadline_days INTEGER CHECK (default_deadline_days IS NULL OR default_deadline_days BETWEEN 1 AND 3650),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      username TEXT UNIQUE COLLATE NOCASE,
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
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      neighborhood TEXT NOT NULL,
      reference TEXT NOT NULL,
      description TEXT NOT NULL,
      specific_details TEXT NOT NULL DEFAULT '{}',
      latitude REAL,
      longitude REAL,
      source TEXT NOT NULL DEFAULT 'MUNICIPE',
      external_protocol TEXT,
      created_by_user_id INTEGER,
      received_at TEXT,
      deadline_at TEXT,
      status TEXT NOT NULL DEFAULT 'RECEBIDA',
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
      materials_used TEXT NOT NULL DEFAULT '',
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
      event_type TEXT NOT NULL DEFAULT 'ATUALIZACAO',
      action TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      previous_priority TEXT,
      new_priority TEXT,
      observation TEXT,
      public_update TEXT,
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

    CREATE TABLE IF NOT EXISTS internal_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
      work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('NOVA_ATRIBUICAO', 'REDISTRIBUICAO', 'ALTERACAO_IMPORTANTE', 'MENSAGEM_ADMINISTRATIVA')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TEXT,
      push_status TEXT NOT NULL DEFAULT 'PENDENTE_CONFIGURACAO',
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_notification_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      public_key TEXT NOT NULL,
      auth_secret TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, endpoint)
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
    CREATE INDEX IF NOT EXISTS idx_service_categories_active ON service_categories(active);
    CREATE INDEX IF NOT EXISTS idx_internal_notifications_user_unread ON internal_notifications(user_id, read_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_internal_notifications_work_order ON internal_notifications(work_order_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_push_notification_subscriptions_user ON push_notification_subscriptions(user_id, active);
  `);

  const requestColumns = database.prepare('PRAGMA table_info(requests)').all().map((column) => column.name);
  if (!requestColumns.includes('requester_user_id')) {
    database.exec('ALTER TABLE requests ADD COLUMN requester_user_id INTEGER');
  }
  if (!requestColumns.includes('latitude')) database.exec('ALTER TABLE requests ADD COLUMN latitude REAL');
  if (!requestColumns.includes('longitude')) database.exec('ALTER TABLE requests ADD COLUMN longitude REAL');
  if (!requestColumns.includes('requester_email')) database.exec('ALTER TABLE requests ADD COLUMN requester_email TEXT');
  if (!requestColumns.includes('source')) database.exec("ALTER TABLE requests ADD COLUMN source TEXT NOT NULL DEFAULT 'MUNICIPE'");
  if (!requestColumns.includes('external_protocol')) database.exec('ALTER TABLE requests ADD COLUMN external_protocol TEXT');
  if (!requestColumns.includes('created_by_user_id')) database.exec('ALTER TABLE requests ADD COLUMN created_by_user_id INTEGER');
  if (!requestColumns.includes('received_at')) database.exec('ALTER TABLE requests ADD COLUMN received_at TEXT');
  if (!requestColumns.includes('deadline_at')) database.exec('ALTER TABLE requests ADD COLUMN deadline_at TEXT');
  database.exec('CREATE INDEX IF NOT EXISTS idx_requests_external_protocol ON requests(external_protocol)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_requests_deadline_at ON requests(deadline_at)');
  database.prepare("UPDATE requests SET source = 'MUNICIPE' WHERE source IS NULL OR TRIM(source) = '' OR source = 'APLICATIVO'").run();
  migrateRequestCategories(database);
  migrateRequestStatuses(database);
  migrateServiceCategories(database);

  const auditColumns = database.prepare('PRAGMA table_info(audit_logs)').all().map((column) => column.name);
  if (!auditColumns.includes('public_update')) database.exec('ALTER TABLE audit_logs ADD COLUMN public_update TEXT');
  if (!auditColumns.includes('event_type')) database.exec("ALTER TABLE audit_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'ATUALIZACAO'");
  database.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_request_event ON audit_logs(request_id, event_type, created_at)');

  const userColumns = database.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('employee_number')) database.exec('ALTER TABLE users ADD COLUMN employee_number TEXT');
  if (!userColumns.includes('username')) database.exec('ALTER TABLE users ADD COLUMN username TEXT');
  database.prepare("UPDATE users SET username = lower(replace(email, '@', '_')) WHERE username IS NULL").run();
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL');
  if (!userColumns.includes('phone')) database.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('job_title')) database.exec("ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('department')) database.exec("ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('service_categories')) database.exec("ALTER TABLE users ADD COLUMN service_categories TEXT NOT NULL DEFAULT '[]'");
  const categoryColumns = database.prepare('PRAGMA table_info(service_categories)').all().map((column) => column.name);
  if (!categoryColumns.includes('default_deadline_days')) database.exec('ALTER TABLE service_categories ADD COLUMN default_deadline_days INTEGER');
  migrateUserRoles(database);

  const executionColumns = database.prepare('PRAGMA table_info(work_order_executions)').all().map((column) => column.name);
  if (!executionColumns.includes('latitude')) database.exec('ALTER TABLE work_order_executions ADD COLUMN latitude REAL');
  if (!executionColumns.includes('longitude')) database.exec('ALTER TABLE work_order_executions ADD COLUMN longitude REAL');
  if (!executionColumns.includes('materials_used')) database.exec("ALTER TABLE work_order_executions ADD COLUMN materials_used TEXT NOT NULL DEFAULT ''");

  migrateLegacyWorkOrders(database);
  migrateWorkOrderStatuses(database);
  migrateLegacyExecutionImages(database);

  const teamInsert = database.prepare('INSERT OR IGNORE INTO teams (name, created_at) VALUES (?, ?)');
  ['Iluminação', 'Estradas', 'Máquinas', 'Manutenção geral'].forEach((name) => teamInsert.run(name, new Date().toISOString()));
  seedServiceCategories(database);
  ensureSystemAuditUser(database);
}

function seedServiceCategories(database) {
  const now = new Date().toISOString();
  const categories = [
    ['ESTRADAS', 'Manutenção de estrada'],
    ['LAMPADAS', 'Iluminação pública'],
    ['LUMINARIAS', 'Instalação de luminária'],
    ['OUTROS', 'Outros'],
  ];
  const insert = database.prepare('INSERT OR IGNORE INTO service_categories (code, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
  categories.forEach(([code, name]) => insert.run(code, name, now, now));
  database.prepare("UPDATE service_categories SET name = 'Manutenção de estrada', updated_at = ? WHERE code = 'ESTRADAS' AND name = 'Manutenção de estradas'").run(now);
  database.prepare("UPDATE service_categories SET name = 'Iluminação pública', updated_at = ? WHERE code = 'LAMPADAS' AND name = 'Troca de lâmpadas'").run(now);
  database.prepare("UPDATE service_categories SET name = 'Instalação de luminária', updated_at = ? WHERE code = 'LUMINARIAS' AND name = 'Instalação de luminárias'").run(now);
}

function migrateServiceCategories(database) {
  const tableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'service_categories'").get()?.sql || '';
  if (!tableSql.includes('code TEXT PRIMARY KEY CHECK')) return;
  database.exec(`
    BEGIN;
    CREATE TABLE service_categories_new (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      default_deadline_days INTEGER CHECK (default_deadline_days IS NULL OR default_deadline_days BETWEEN 1 AND 3650),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO service_categories_new (code, name, active, default_deadline_days, created_at, updated_at)
      SELECT code, name, active, NULL, created_at, updated_at FROM service_categories;
    DROP TABLE service_categories;
    ALTER TABLE service_categories_new RENAME TO service_categories;
    CREATE INDEX IF NOT EXISTS idx_service_categories_active ON service_categories(active);
    COMMIT;
  `);
}

function migrateRequestStatuses(database) {
  const legacyStatuses = {
    AGUARDANDO_ANALISE: 'RECEBIDA',
    INFORMACOES_ADICIONAIS: 'PENDENTE',
    APROVADA: 'ENCAMINHADA',
    PROGRAMADA: 'ENCAMINHADA',
    EM_EXECUCAO: 'EM_ATENDIMENTO',
    INDEFERIDA: 'NAO_REALIZADA',
  };
  const updateRequest = database.prepare('UPDATE requests SET status = ? WHERE status = ?');
  const updatePreviousStatus = database.prepare('UPDATE audit_logs SET previous_status = ? WHERE previous_status = ?');
  const updateNewStatus = database.prepare('UPDATE audit_logs SET new_status = ? WHERE new_status = ?');
  Object.entries(legacyStatuses).forEach(([legacyStatus, standardizedStatus]) => {
    updateRequest.run(standardizedStatus, legacyStatus);
    updatePreviousStatus.run(standardizedStatus, legacyStatus);
    updateNewStatus.run(standardizedStatus, legacyStatus);
  });
}

function migrateRequestCategories(database) {
  const tableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'").get()?.sql || '';
  if (!tableSql.includes("category TEXT NOT NULL CHECK")) return;
  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec(`
      BEGIN;
      CREATE TABLE requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        protocol TEXT NOT NULL UNIQUE,
        requester_user_id INTEGER REFERENCES users(id),
        requester_name TEXT NOT NULL,
        requester_type TEXT NOT NULL CHECK (requester_type IN ('MUNICIPE', 'VEREADOR', 'FUNCIONARIO')),
        phone TEXT NOT NULL,
        requester_email TEXT,
        category TEXT NOT NULL,
        location TEXT NOT NULL,
        neighborhood TEXT NOT NULL,
        reference TEXT NOT NULL,
        description TEXT NOT NULL,
        specific_details TEXT NOT NULL DEFAULT '{}',
        latitude REAL,
        longitude REAL,
        source TEXT NOT NULL DEFAULT 'MUNICIPE',
        external_protocol TEXT,
        created_by_user_id INTEGER,
        received_at TEXT,
        deadline_at TEXT,
        status TEXT NOT NULL DEFAULT 'RECEBIDA',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO requests_new (
        id, protocol, requester_user_id, requester_name, requester_type, phone, requester_email, category,
        location, neighborhood, reference, description, specific_details, latitude, longitude, source,
        external_protocol, created_by_user_id, received_at, deadline_at, status, priority, created_at, updated_at
      ) SELECT
        id, protocol, requester_user_id, requester_name, requester_type, phone, requester_email, category,
        location, neighborhood, reference, description, specific_details, latitude, longitude, source,
        external_protocol, created_by_user_id, received_at, deadline_at, status, priority, created_at, updated_at
      FROM requests;
      DROP TABLE requests;
      ALTER TABLE requests_new RENAME TO requests;
      CREATE INDEX IF NOT EXISTS idx_requests_protocol ON requests(protocol);
      CREATE INDEX IF NOT EXISTS idx_requests_external_protocol ON requests(external_protocol);
      CREATE INDEX IF NOT EXISTS idx_requests_deadline_at ON requests(deadline_at);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
      CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
      COMMIT;
    `);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
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
        username TEXT UNIQUE COLLATE NOCASE,
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
        id, name, email, username, password_hash, role, team_id, employee_number, phone,
        job_title, department, service_categories, active, created_at, updated_at
      ) SELECT
        id, name, email, username, password_hash, role, team_id, employee_number, phone,
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
