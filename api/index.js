const { createRuntime } = require('../src/server/runtime');

const runtime = createRuntime();

module.exports = (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const route = url.searchParams.get('_route');

  if (route !== null) {
    url.pathname = `/api/${route}`;
    url.searchParams.delete('_route');
    request.url = `${url.pathname}${url.search}`;
  }

  return runtime.handler(request, response);
};
