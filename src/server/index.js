const http = require('node:http');
const { config } = require('./config');
const { createRuntime } = require('./runtime');

const runtime = createRuntime();
const server = http.createServer(runtime.handler);

server.listen(config.port, () => {
  console.log(`Zelacity Plataforma disponível em http://localhost:${config.port}`);
  if (!runtime.authService.hasAdministrator()) {
    console.log('Nenhum administrador cadastrado. Execute: npm run bootstrap-admin -- email senha-segura Nome');
  }
});

function closeServer(signal) {
  server.close(() => {
    runtime.close();
    console.log(`Servidor encerrado (${signal}).`);
    process.exit(0);
  });
}

process.on('SIGINT', () => closeServer('SIGINT'));
process.on('SIGTERM', () => closeServer('SIGTERM'));
