const { Worker } = require('node:worker_threads');

const RESPONSE_BYTES = 64 * 1024 * 1024;

const workerSource = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  const { neon } = require('@neondatabase/serverless');
  const state = new Int32Array(workerData.readyBuffer);
  const sqlClient = neon(workerData.connectionString);

  function encode(value) {
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __buffer: Buffer.from(value).toString('base64') };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    return value;
  }

  function writeResponse(buffer, payload) {
    const bytes = Buffer.from(JSON.stringify(encode(payload)), 'utf8');
    if (bytes.length > buffer.byteLength - 12) throw new Error('A resposta do banco excedeu o limite permitido.');
    const output = new Uint8Array(buffer, 12);
    output.set(bytes);
    const responseState = new Int32Array(buffer, 0, 3);
    Atomics.store(responseState, 1, bytes.length);
    Atomics.store(responseState, 2, payload.ok ? 0 : 1);
    Atomics.store(responseState, 0, 1);
    Atomics.notify(responseState, 0);
  }

  async function main() {
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
    function rawQuery(statement) {
      const strings = [statement];
      strings.raw = strings;
      return sqlClient(strings);
    }

    parentPort.on('message', async ({ buffer, sql, params, batch }) => {
      try {
        if (Array.isArray(batch)) {
          const results = await sqlClient.transaction(batch.map((statement) => rawQuery(statement)));
          writeResponse(buffer, {
            ok: true,
            rows: results.map((result) => Array.isArray(result) ? result : (result.rows || [])),
            rowCount: results.length,
          });
          return;
        }
        if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
          writeResponse(buffer, { ok: true, rows: [], rowCount: 0 });
          return;
        }
        const result = await sqlClient.query(sql, params || []);
        const rows = Array.isArray(result) ? result : (result.rows || []);
        writeResponse(buffer, { ok: true, rows, rowCount: rows.length });
      } catch (error) {
        writeResponse(buffer, { ok: false, error: error.message || 'Erro de banco de dados.' });
      }
    });
  }

  main().catch((error) => {
    Atomics.store(state, 0, 2);
    Atomics.notify(state, 0);
    parentPort.postMessage({ type: 'fatal', error: error.message || 'Não foi possível conectar ao banco.' });
  });
`;

function decode(value) {
  if (value && typeof value === 'object' && value.__buffer) return Buffer.from(value.__buffer, 'base64');
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  return value;
}

function toPostgresSql(source, { returning = false } = {}) {
  let sql = String(source || '').trim().replace(/;\s*$/, '');
  if (!sql) return sql;
  if (/^PRAGMA\b/i.test(sql)) return '';
  const ignoreInsert = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
  if (ignoreInsert) sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  let index = 0;
  sql = sql.replace(/\?/g, () => `$${++index}`);
  if (ignoreInsert) sql += ' ON CONFLICT DO NOTHING';
  if (returning && /^(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) sql += ' RETURNING *';
  return sql;
}

class PostgresStatement {
  constructor(database, source) {
    this.database = database;
    this.source = source;
  }

  get(...params) {
    return this.database.query(toPostgresSql(this.source), params).rows[0] || null;
  }

  all(...params) {
    return this.database.query(toPostgresSql(this.source), params).rows;
  }

  run(...params) {
    const result = this.database.query(toPostgresSql(this.source, { returning: true }), params);
    const firstRow = result.rows[0] || {};
    return { changes: result.rowCount, lastInsertRowid: firstRow.id ?? null };
  }
}

class PostgresSyncDatabase {
  constructor(connectionString) {
    const readyBuffer = new SharedArrayBuffer(4);
    const readyState = new Int32Array(readyBuffer);
    this.worker = new Worker(workerSource, { eval: true, workerData: { connectionString, readyBuffer } });
    const waitResult = Atomics.wait(readyState, 0, 0, 30000);
    if (waitResult === 'timed-out' || Atomics.load(readyState, 0) !== 1) throw new Error('Não foi possível conectar ao Neon Postgres.');
  }

  query(sql, params = []) {
    const buffer = new SharedArrayBuffer(12 + RESPONSE_BYTES);
    const responseState = new Int32Array(buffer, 0, 3);
    this.worker.postMessage({ buffer, sql, params });
    const waitResult = Atomics.wait(responseState, 0, 0, 30000);
    if (waitResult === 'timed-out' || Atomics.load(responseState, 0) !== 1) throw new Error('O banco de dados não respondeu a tempo.');
    const length = Atomics.load(responseState, 1);
    const payload = JSON.parse(Buffer.from(new Uint8Array(buffer, 12, length)).toString('utf8'));
    if (!payload.ok) throw new Error(payload.error || 'Erro de banco de dados.');
    payload.rows = decode(payload.rows);
    return payload;
  }

  prepare(source) {
    return new PostgresStatement(this, source);
  }

  exec(source) {
    const sql = String(source || '').trim().replace(/^BEGIN\s+IMMEDIATE\b/i, 'BEGIN');
    if (!sql || /^PRAGMA\b/i.test(sql)) return;
    const statements = [];
    let current = '';
    let quote = null;
    let dollarQuote = null;
    for (let index = 0; index < sql.length; index += 1) {
      const char = sql[index];
      const next = sql[index + 1];
      if (dollarQuote) {
        current += char;
        if (sql.startsWith(dollarQuote, index)) {
          current += sql.slice(index + 1, index + dollarQuote.length);
          index += dollarQuote.length - 1;
          dollarQuote = null;
        }
        continue;
      }
      if (quote) {
        current += char;
        if (char === quote && next === quote) { current += next; index += 1; }
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; current += char; continue; }
      if (char === '$' && sql.slice(index).match(/^\$[A-Za-z_]*\$/)) {
        dollarQuote = sql.slice(index).match(/^\$[A-Za-z_]*\$/)[0];
        current += dollarQuote;
        index += dollarQuote.length - 1;
        continue;
      }
      if (char === ';') { if (current.trim()) statements.push(current.trim()); current = ''; }
      else current += char;
    }
    if (current.trim()) statements.push(current.trim());
    if (!statements.length) return;
    const postgresStatements = statements
      .map((statement) => toPostgresSql(statement))
      .filter(Boolean);
    this.batch(postgresStatements);
  }

  batch(statements) {
    const buffer = new SharedArrayBuffer(12 + RESPONSE_BYTES);
    const responseState = new Int32Array(buffer, 0, 3);
    this.worker.postMessage({ buffer, batch: statements });
    const waitResult = Atomics.wait(responseState, 0, 0, 30000);
    if (waitResult === 'timed-out' || Atomics.load(responseState, 0) !== 1) throw new Error('O banco de dados não respondeu a tempo.');
    const length = Atomics.load(responseState, 1);
    const payload = JSON.parse(Buffer.from(new Uint8Array(buffer, 12, length)).toString('utf8'));
    if (!payload.ok) throw new Error(payload.error || 'Erro de banco de dados.');
    payload.rows = decode(payload.rows);
    return payload;
  }

  close() {
    this.worker.terminate();
  }
}

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_categories (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    default_deadline_days INTEGER CHECK (default_deadline_days IS NULL OR default_deadline_days BETWEEN 1 AND 3650),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('SOLICITANTE', 'VEREADOR', 'MANUTENCAO', 'ADMINISTRADOR')),
    team_id INTEGER REFERENCES teams(id),
    employee_number TEXT,
    phone TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    service_categories TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
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
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source TEXT NOT NULL DEFAULT 'MUNICIPE',
    external_protocol TEXT,
    created_by_user_id INTEGER,
    received_at TIMESTAMPTZ,
    deadline_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'RECEBIDA',
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_orders (
    id SERIAL PRIMARY KEY,
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
    scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'PROGRAMADA',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_order_updates (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_order_executions (
    id SERIAL PRIMARY KEY,
    work_order_id INTEGER NOT NULL UNIQUE REFERENCES work_orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    observation TEXT NOT NULL,
    materials_used TEXT NOT NULL DEFAULT '',
    before_photo_path TEXT,
    after_photo_path TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    executed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS request_images (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    image_type TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
    content_data BYTEA,
    uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL DEFAULT 'ATUALIZACAO',
    action TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    previous_priority TEXT,
    new_priority TEXT,
    observation TEXT,
    public_update TEXT,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notification_queue (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE_INTEGRACAO',
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS internal_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
    work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    push_status TEXT NOT NULL DEFAULT 'PENDENTE_CONFIGURACAO',
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_notification_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    public_key TEXT NOT NULL,
    auth_secret TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_internal_notifications_user_unread ON internal_notifications(user_id, read_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_internal_notifications_work_order ON internal_notifications(work_order_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_push_notification_subscriptions_user ON push_notification_subscriptions(user_id, active);
  CREATE OR REPLACE FUNCTION datetime(value TEXT, modifier TEXT DEFAULT NULL) RETURNS TIMESTAMPTZ AS $$
    SELECT CASE WHEN lower(value) = 'now' THEN now() + CASE WHEN modifier = '+2 days' THEN interval '2 days' ELSE interval '0 seconds' END ELSE value::timestamptz END
  $$ LANGUAGE SQL STABLE;
  CREATE OR REPLACE FUNCTION datetime(value TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$ SELECT value $$ LANGUAGE SQL IMMUTABLE;
  CREATE OR REPLACE FUNCTION julianday(value TEXT) RETURNS DOUBLE PRECISION AS $$ SELECT EXTRACT(EPOCH FROM datetime(value)) / 86400.0 + 2440587.5 $$ LANGUAGE SQL STABLE;
  CREATE OR REPLACE FUNCTION julianday(value TIMESTAMPTZ) RETURNS DOUBLE PRECISION AS $$ SELECT EXTRACT(EPOCH FROM value) / 86400.0 + 2440587.5 $$ LANGUAGE SQL IMMUTABLE;
  CREATE OR REPLACE FUNCTION strftime(format TEXT, value TIMESTAMPTZ) RETURNS TEXT AS $$ SELECT TO_CHAR(value, CASE WHEN format = '%Y-%m' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD"T"HH24:MI:SS' END) $$ LANGUAGE SQL IMMUTABLE;
`;

function createPostgresDatabase(connectionString) {
  const database = new PostgresSyncDatabase(connectionString);
  database.exec(POSTGRES_SCHEMA);
  const now = new Date().toISOString();
  const teamInsert = database.prepare('INSERT OR IGNORE INTO teams (name, created_at) VALUES (?, ?)');
  ['Iluminação', 'Estradas', 'Máquinas', 'Manutenção geral'].forEach((name) => teamInsert.run(name, now));
  const categoryInsert = database.prepare('INSERT OR IGNORE INTO service_categories (code, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
  [['ESTRADAS', 'Manutenção de estrada'], ['LAMPADAS', 'Iluminação pública'], ['LUMINARIAS', 'Instalação de luminária'], ['OUTROS', 'Outros']].forEach(([code, name]) => categoryInsert.run(code, name, now, now));
  database.prepare("INSERT OR IGNORE INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, 'SOLICITANTE', 0, ?, ?)").run('Sistema público', 'sistema.publico@zelacity.local', 'login-bloqueado', now, now);
  return database;
}

module.exports = { createPostgresDatabase };
