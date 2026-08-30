const { createHash, randomBytes } = require('node:crypto');
const { hashPassword, validatePassword, verifyPassword } = require('./password');

const ROLES = new Set(['SOLICITANTE', 'VEREADOR', 'MANUTENCAO', 'ADMINISTRADOR']);
const SERVICE_CATEGORIES = new Set(['ESTRADAS', 'LAMPADAS', 'LUMINARIAS']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function normalizeCategories(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const categories = [...new Set(values.map((item) => cleanText(item).toUpperCase()).filter(Boolean))];
  return categories.every((category) => SERVICE_CATEGORIES.has(category)) ? categories : null;
}

function normalizeActive(value, fallback = true) {
  if (value === undefined) return fallback;
  return ![false, 0, '0', 'false', 'FALSE'].includes(value);
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    teamId: user.team_id,
    teamName: user.team_name || null,
    serviceCategories: (() => { try { return JSON.parse(user.service_categories || '[]'); } catch { return []; } })(),
  };
}

class AuthService {
  constructor(database, { sessionHours = 12 } = {}) {
    this.database = database;
    this.sessionHours = sessionHours;
  }

  hasAdministrator() {
    return Boolean(this.database.prepare("SELECT 1 FROM users WHERE role = 'ADMINISTRADOR' AND active = 1 LIMIT 1").get());
  }

  findUser(id) {
    return this.database.prepare(`
      SELECT users.*, teams.name AS team_name
      FROM users LEFT JOIN teams ON teams.id = users.team_id
      WHERE users.id = ?
    `).get(id) || null;
  }

  validateProfile({ name, email, role, teamId, phone, jobTitle, department, serviceCategories }, { allowLegacyRequester = false } = {}) {
    const normalizedName = cleanText(name);
    const normalizedEmail = normalizeEmail(email);
    const normalizedRole = cleanText(role).toUpperCase();
    const normalizedTeamId = teamId === null || teamId === undefined || teamId === '' ? null : Number(teamId);
    const normalizedPhone = cleanText(phone);
    const normalizedJobTitle = cleanText(jobTitle);
    const normalizedDepartment = cleanText(department);
    const normalizedCategories = normalizeCategories(serviceCategories);

    if (!normalizedName) return { error: 'Informe o nome do usuário.' };
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return { error: 'Informe um e-mail válido.' };
    if (!ROLES.has(normalizedRole) || (!allowLegacyRequester && normalizedRole === 'SOLICITANTE')) return { error: 'Perfil de usuário interno inválido.' };
    if (normalizedRole === 'MANUTENCAO' && (!Number.isInteger(normalizedTeamId) || normalizedTeamId < 1)) return { error: 'Selecione uma equipe para o funcionário de manutenção.' };
    if (normalizedRole === 'MANUTENCAO' && !normalizedPhone) return { error: 'Informe o telefone do funcionário.' };
    if (normalizedRole === 'MANUTENCAO' && !normalizedJobTitle) return { error: 'Informe a função do funcionário.' };
    if (normalizedRole === 'MANUTENCAO' && !normalizedDepartment) return { error: 'Informe o setor do funcionário.' };
    if (!normalizedCategories) return { error: 'Selecione categorias de serviço válidas.' };
    if (normalizedRole === 'MANUTENCAO' && !normalizedCategories.length) return { error: 'Selecione pelo menos um tipo de serviço sob responsabilidade do funcionário.' };
    if (normalizedTeamId && !this.database.prepare('SELECT 1 FROM teams WHERE id = ?').get(normalizedTeamId)) return { error: 'Equipe não encontrada.' };
    return { profile: { name: normalizedName, email: normalizedEmail, role: normalizedRole, teamId: normalizedTeamId, phone: normalizedPhone, jobTitle: normalizedJobTitle, department: normalizedDepartment, serviceCategories: normalizedCategories } };
  }

  createUser({ name, email, password, role, teamId = null, employeeNumber = '', phone = '', jobTitle = '', department = '', serviceCategories = [] }) {
    const profileResult = this.validateProfile({ name, email, role, teamId, phone, jobTitle, department, serviceCategories });
    if (profileResult.error) return profileResult;
    const passwordError = validatePassword(password);
    if (passwordError) return { error: passwordError };
    const { profile } = profileResult;
    const now = new Date().toISOString();
    try {
      const result = this.database.prepare(`
        INSERT INTO users (
          name, email, password_hash, role, team_id, employee_number, phone,
          job_title, department, service_categories, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(profile.name, profile.email, hashPassword(password), profile.role, profile.teamId, cleanText(employeeNumber) || null, profile.phone, profile.jobTitle, profile.department, JSON.stringify(profile.serviceCategories), now, now);
      return { user: toPublicUser(this.findUser(Number(result.lastInsertRowid))) };
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return { error: 'Já existe um usuário com este e-mail.' };
      throw error;
    }
  }

  updateUser(id, changes) {
    const current = this.findUser(Number(id));
    if (!current) return { notFound: true };
    const profileResult = this.validateProfile({
      name: Object.hasOwn(changes, 'name') ? changes.name : current.name,
      email: Object.hasOwn(changes, 'email') ? changes.email : current.email,
      role: Object.hasOwn(changes, 'role') ? changes.role : current.role,
      teamId: Object.hasOwn(changes, 'teamId') ? changes.teamId : current.team_id,
      phone: Object.hasOwn(changes, 'phone') ? changes.phone : current.phone,
      jobTitle: Object.hasOwn(changes, 'jobTitle') ? changes.jobTitle : current.job_title,
      department: Object.hasOwn(changes, 'department') ? changes.department : current.department,
      serviceCategories: Object.hasOwn(changes, 'serviceCategories') ? changes.serviceCategories : (() => { try { return JSON.parse(current.service_categories || '[]'); } catch { return []; } })(),
    }, { allowLegacyRequester: current.role === 'SOLICITANTE' });
    if (profileResult.error) return profileResult;
    const { profile } = profileResult;
    const active = normalizeActive(changes.active, Boolean(current.active));
    if (current.role === 'ADMINISTRADOR' && (!active || profile.role !== 'ADMINISTRADOR')) {
      const activeAdministrators = this.database.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMINISTRADOR' AND active = 1").get().total;
      if (activeAdministrators <= 1) return { error: 'Não é possível desativar ou remover o último administrador ativo.' };
    }
    let passwordHash = current.password_hash;
    if (cleanText(changes.password)) {
      const passwordError = validatePassword(changes.password);
      if (passwordError) return { error: passwordError };
      passwordHash = hashPassword(changes.password);
    }
    try {
      this.database.prepare(`
        UPDATE users SET
          name = ?, email = ?, password_hash = ?, role = ?, team_id = ?, employee_number = ?,
          phone = ?, job_title = ?, department = ?, service_categories = ?, active = ?, updated_at = ?
        WHERE id = ?
      `).run(profile.name, profile.email, passwordHash, profile.role, profile.teamId, Object.hasOwn(changes, 'employeeNumber') ? cleanText(changes.employeeNumber) || null : current.employee_number, profile.phone, profile.jobTitle, profile.department, JSON.stringify(profile.serviceCategories), active ? 1 : 0, new Date().toISOString(), current.id);
      return { user: toPublicUser(this.findUser(current.id)) };
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return { error: 'Já existe um usuário com este e-mail.' };
      throw error;
    }
  }

  authenticate(email, password) {
    const user = this.database.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(normalizeEmail(email));
    if (!user || !verifyPassword(password || '', user.password_hash)) return { error: 'E-mail ou senha inválidos.' };
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionHours * 60 * 60 * 1000).toISOString();
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
    this.database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash, user.id, expiresAt, now.toISOString());
    return { token, expiresAt, user: toPublicUser(this.findUser(user.id)) };
  }

  getUserFromToken(token) {
    if (!token) return null;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = this.database.prepare(`
      SELECT users.*, teams.name AS team_name
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      LEFT JOIN teams ON teams.id = users.team_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
    `).get(tokenHash, new Date().toISOString());
    return user ? toPublicUser(user) : null;
  }

  logout(token) {
    if (!token) return;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  listUsers() {
    return this.database.prepare(`
      SELECT users.id, users.name, users.email, users.role, users.team_id, users.employee_number,
             users.phone, users.job_title, users.department, users.service_categories, users.active,
             users.created_at, teams.name AS team_name
      FROM users LEFT JOIN teams ON teams.id = users.team_id
      WHERE users.email <> 'sistema.publico@zelacity.local'
      ORDER BY users.active DESC, users.name COLLATE NOCASE
    `).all();
  }
}

module.exports = { AuthService, ROLES, SERVICE_CATEGORIES, toPublicUser };
