const DEMO_PASSWORD = 'Demo2026';

function seedDemoData(database, authService) {
  if (authService.hasAdministrator()) return;

  const now = new Date().toISOString();
  const createTeam = database.prepare('INSERT OR IGNORE INTO teams (name, created_at) VALUES (?, ?)');
  createTeam.run('Equipe de Iluminação', now);
  createTeam.run('Equipe de Vias', now);

  const lightingTeam = database.prepare('SELECT id FROM teams WHERE name = ?').get('Equipe de Iluminação');
  const roadsTeam = database.prepare('SELECT id FROM teams WHERE name = ?').get('Equipe de Vias');
  const administrator = authService.createUser({ name: 'Administração de Demonstração', email: 'admin@zelacity.teste', password: DEMO_PASSWORD, role: 'ADMINISTRADOR' });
  const lightingWorker = authService.createUser({ name: 'Marina Eletricista', email: 'iluminacao@zelacity.teste', password: DEMO_PASSWORD, role: 'MANUTENCAO', teamId: lightingTeam.id, employeeNumber: 'DEMO-001', phone: '(00) 90000-0001', jobTitle: 'Eletricista', department: 'Iluminação pública', serviceCategories: ['LAMPADAS', 'LUMINARIAS'] });
  const roadsWorker = authService.createUser({ name: 'Carlos Operador', email: 'vias@zelacity.teste', password: DEMO_PASSWORD, role: 'MANUTENCAO', teamId: roadsTeam.id, employeeNumber: 'DEMO-002', phone: '(00) 90000-0002', jobTitle: 'Operador de máquinas', department: 'Manutenção de vias', serviceCategories: ['ESTRADAS'] });
  if (administrator.error || lightingWorker.error || roadsWorker.error) throw new Error(administrator.error || lightingWorker.error || roadsWorker.error);

  const insertRequest = database.prepare(`
    INSERT OR IGNORE INTO requests (protocol, requester_name, requester_type, phone, requester_email, category, location, neighborhood, reference, description, specific_details, latitude, longitude, status, priority, created_at, updated_at)
    VALUES (?, ?, 'MUNICIPE', ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 'PROGRAMADA', ?, ?, ?)
  `);
  const requests = [
    ['SOL-DEMO-00001', 'Morador de demonstração', '(00) 90000-0101', 'morador1@teste.local', 'LAMPADAS', 'Rua das Flores, 120', 'Centro', 'Praça principal', 'Lâmpada apagada em poste da via pública.', -23.1571, -46.4060, 'ALTA'],
    ['SOL-DEMO-00002', 'Morador de demonstração', '(00) 90000-0102', 'morador2@teste.local', 'LUMINARIAS', 'Avenida Municipal, 45', 'Jardim', 'Em frente à escola', 'Instalação de luminária em ponto escuro.', -23.1590, -46.4042, 'NORMAL'],
    ['SOL-DEMO-00003', 'Morador de demonstração', '(00) 90000-0103', 'morador3@teste.local', 'ESTRADAS', 'Estrada do Campo, km 2', 'Rural', 'Próximo ao córrego', 'Recuperação de trecho com buracos.', -23.1622, -46.4105, 'URGENTE'],
  ];
  requests.forEach((request) => insertRequest.run(...request, now, now));

  const requestByProtocol = database.prepare('SELECT id, protocol, category, location, description, priority FROM requests WHERE protocol = ?');
  const insertOrder = database.prepare(`
    INSERT OR IGNORE INTO work_orders (number, request_id, protocol, category, location, description, priority, team_id, assigned_user_id, created_by_user_id, scheduled_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  [['OS-DEMO-00001', 'SOL-DEMO-00001', lightingTeam.id, lightingWorker.user.id, 'ATRIBUIDA'], ['OS-DEMO-00002', 'SOL-DEMO-00002', lightingTeam.id, lightingWorker.user.id, 'PROGRAMADA'], ['OS-DEMO-00003', 'SOL-DEMO-00003', roadsTeam.id, roadsWorker.user.id, 'EM_EXECUCAO']].forEach(([number, protocol, teamId, userId, status], index) => {
    const request = requestByProtocol.get(protocol);
    const scheduledAt = new Date(Date.now() + (index + 1) * 86400000).toISOString();
    insertOrder.run(number, request.id, request.protocol, request.category, request.location, request.description, request.priority, teamId, userId, administrator.user.id, scheduledAt, status, now, now);
  });
}

module.exports = { DEMO_PASSWORD, seedDemoData };
