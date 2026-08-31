const { config } = require('./config');
const { createApp } = require('./app');
const { createDatabase } = require('../database/database');
const { RequestRepository } = require('./requestRepository');
const { RequestService } = require('./requestService');
const { WorkOrderRepository } = require('./workOrderRepository');
const { WorkOrderService } = require('./workOrderService');
const { ReportRepository } = require('./reportRepository');
const { ReportService } = require('./reportService');
const { AuthService } = require('../auth/authService');
const { PhotoStorage } = require('./photoStorage');
const { ImageRepository } = require('./imageRepository');
const { AuditRepository } = require('./auditRepository');
const { NotificationService } = require('./notificationService');

function createRuntime() {
  const database = createDatabase(config.databasePath);
  const requestRepository = new RequestRepository(database);
  const photoStorage = new PhotoStorage(config.uploadDirectory);
  const imageRepository = new ImageRepository(database);
  const auditRepository = new AuditRepository(database);
  const notificationService = new NotificationService(database);
  const requestService = new RequestService(requestRepository, photoStorage, imageRepository, auditRepository, notificationService);
  const workOrderRepository = new WorkOrderRepository(database);
  const workOrderService = new WorkOrderService(workOrderRepository, photoStorage, auditRepository);
  const reportRepository = new ReportRepository(database);
  const reportService = new ReportService(reportRepository);
  const authService = new AuthService(database, config);

  return {
    authService,
    close: () => database.close(),
    handler: createApp({ requestService, workOrderService, reportService, authService, imageRepository, auditRepository }),
  };
}

module.exports = { createRuntime };
