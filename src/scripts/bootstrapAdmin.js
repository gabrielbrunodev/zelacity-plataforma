const { createDatabase } = require('../database/database');
const { config } = require('../server/config');
const { AuthService } = require('../auth/authService');

const [email, password, ...nameParts] = process.argv.slice(2);
if (!email || !password) {
  console.error('Uso: npm run bootstrap-admin -- email@prefeitura.gov.br senha-segura [Nome do Administrador]');
  process.exit(1);
}

const database = createDatabase(config.databasePath);
const authService = new AuthService(database, config);
if (authService.hasAdministrator()) {
  console.error('Já existe um administrador cadastrado. Use o painel administrativo para gerenciar usuários.');
  database.close();
  process.exit(1);
}

const result = authService.createUser({
  name: nameParts.join(' ') || 'Administrador',
  email,
  password,
  role: 'ADMINISTRADOR',
});
database.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
console.log(`Administrador criado com sucesso: ${result.user.email}`);
