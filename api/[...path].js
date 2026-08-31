const { createRuntime } = require('../src/server/runtime');

const runtime = createRuntime();

module.exports = runtime.handler;
