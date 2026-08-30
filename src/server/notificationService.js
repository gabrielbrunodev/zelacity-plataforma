class NotificationService {
  constructor(database) {
    this.database = database;
  }

  queueProtocol(request) {
    const now = new Date().toISOString();
    const message = `Sua solicitação foi registrada na Zelacity Plataforma. Protocolo: ${request.protocol}.`;
    const channels = [];
    const insert = this.database.prepare(`
      INSERT INTO notification_queue (request_id, channel, destination, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, 'PENDENTE_INTEGRACAO', ?, ?, ?)
    `);
    try {
      if (request.email) {
        insert.run(request.id, 'EMAIL', request.email, JSON.stringify({ protocol: request.protocol, message }), now, now);
        channels.push('EMAIL');
      }
      if (request.phone) {
        insert.run(request.id, 'WHATSAPP', request.phone, JSON.stringify({ protocol: request.protocol, message }), now, now);
        channels.push('WHATSAPP');
      }
    } catch {
      // A fila é opcional: uma indisponibilidade de integração não bloqueia o cadastro.
      return { channels: [], queued: false };
    }
    return { channels, queued: Boolean(channels.length) };
  }
}

module.exports = { NotificationService };
