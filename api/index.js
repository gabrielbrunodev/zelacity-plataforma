const { createRuntime } = require('../src/server/runtime');

let runtime = null;

function getRuntime() {
  if (!runtime) runtime = createRuntime();
  return runtime;
}

async function sendHealth(response) {
  try {
    if (process.env.DATABASE_URL) {
      const { neon } = require('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      await sql.query('SELECT 1 AS ok');
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ status: 'ok', service: 'Zelacity Plataforma API', database: 'neon' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', service: 'Zelacity Plataforma API', database: 'sqlite' }));
  } catch (error) {
    console.error('Falha no health check do banco:', error);
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: 'error', service: 'Zelacity Plataforma API', database: 'unavailable' }));
  }
}

module.exports = async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const route = url.searchParams.get('_route');

  if (request.method === 'GET' && route === 'health') {
    await sendHealth(response);
    return;
  }

  if (route !== null) {
    url.pathname = `/api/${route}`;
    url.searchParams.delete('_route');
    request.url = `${url.pathname}${url.search}`;
  }

  return getRuntime().handler(request, response);
};
