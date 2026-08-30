const path = require('node:path');

const config = {
  port: Number(process.env.PORT) || 3000,
  publicDirectory: path.resolve(__dirname, '../../public'),
  databasePath: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.resolve(__dirname, '../../data/munimanutencao.sqlite'),
  uploadDirectory: process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : path.resolve(__dirname, '../../uploads'),
  googleMapsApiKey: (process.env.GOOGLE_MAPS_API_KEY || '').trim(),
  sessionHours: 12,
};

module.exports = { config };
