const path = require('node:path');

const isVercel = process.env.VERCEL === '1';
const writableDirectory = isVercel ? '/tmp' : path.resolve(__dirname, '../..');

const config = {
  port: Number(process.env.PORT) || 3000,
  publicDirectory: path.resolve(__dirname, '../../public'),
  databasePath: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(writableDirectory, 'data', 'munimanutencao.sqlite'),
  uploadDirectory: process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : path.join(writableDirectory, 'uploads'),
  googleMapsApiKey: (process.env.GOOGLE_MAPS_API_KEY || '').trim(),
  sessionHours: 12,
};

module.exports = { config };
