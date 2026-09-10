const path = require('node:path');

const isVercel = process.env.VERCEL === '1';
const writableDirectory = isVercel ? '/tmp' : path.resolve(__dirname, '../..');

function parseAllowedOrigins(value) {
  return new Set(String(value || '').split(',').map((origin) => origin.trim()).filter((origin) => {
    try {
      const parsed = new URL(origin);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.origin === origin;
    } catch {
      return false;
    }
  }));
}

const config = {
  port: Number(process.env.PORT) || 3000,
  publicDirectory: path.resolve(__dirname, '../../public'),
  databasePath: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(writableDirectory, 'data', 'munimanutencao.sqlite'),
  uploadDirectory: process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : path.join(writableDirectory, 'uploads'),
  googleMapsApiKey: (process.env.GOOGLE_MAPS_API_KEY || '').trim(),
  demoMode: process.env.DEMO_MODE === 'true' || (isVercel && process.env.DEMO_MODE !== 'false'),
  requireAfterExecutionPhoto: process.env.REQUIRE_AFTER_EXECUTION_PHOTO === 'true',
  secureCookies: isVercel || process.env.COOKIE_SECURE === 'true',
  sessionSecret: process.env.SESSION_SECRET || 'local-development-session-secret',
  mobileAllowedOrigins: parseAllowedOrigins(process.env.MOBILE_ALLOWED_ORIGINS),
  sessionHours: 12,
};

module.exports = { config };
