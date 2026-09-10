const NOTIFICATION_TYPES = new Set(['NOVA_ATRIBUICAO', 'REDISTRIBUICAO', 'ALTERACAO_IMPORTANTE', 'MENSAGEM_ADMINISTRATIVA']);

const categoryLabels = {
  ESTRADAS: 'Manutenção de estrada',
  LAMPADAS: 'Troca de lâmpada',
  LUMINARIAS: 'Instalação de luminária',
  OUTROS: 'Outros',
};

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

class InternalNotificationService {
  constructor(database) {
    this.database = database;
  }

  recipientsForWorkOrder(workOrder) {
    const members = this.database.prepare("SELECT id, service_categories FROM users WHERE role = 'MANUTENCAO' AND active = 1 AND (team_id = ? OR service_categories LIKE ?)").all(workOrder.team_id, `%\"${workOrder.category}\"%`);
    const eligible = members.filter((member) => {
      try {
        const categories = JSON.parse(member.service_categories || '[]');
        return !categories.length || categories.includes(workOrder.category);
      } catch {
        return true;
      }
    }).map((member) => Number(member.id));
    return eligible.length ? eligible : (workOrder.assigned_user_id ? [Number(workOrder.assigned_user_id)] : []);
  }

  create({ userIds, requestId = null, workOrderId = null, type, title, message, createdByUserId = null }) {
    if (!NOTIFICATION_TYPES.has(type)) throw new Error('Tipo de notificação inválido.');
    const recipients = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const normalizedTitle = cleanText(title).slice(0, 120);
    const normalizedMessage = cleanText(message).slice(0, 1000);
    if (!recipients.length || !normalizedTitle || !normalizedMessage) return [];
    const now = new Date().toISOString();
    const insert = this.database.prepare(`
      INSERT INTO internal_notifications (
        user_id, request_id, work_order_id, type, title, message, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return recipients.map((userId) => ({
      id: Number(insert.run(userId, requestId, workOrderId, type, normalizedTitle, normalizedMessage, createdByUserId, now).lastInsertRowid),
      userId,
    }));
  }

  workOrderMessage(workOrder) {
    const category = categoryLabels[workOrder.category] || workOrder.category;
    const neighborhood = workOrder.neighborhood ? `Bairro ${workOrder.neighborhood}` : 'Local informado';
    return `${category} — ${neighborhood}\nSolicitação #${workOrder.protocol}`;
  }

  notifyAssignment(workOrder, { redistributed = false, createdByUserId = null } = {}) {
    return this.create({
      userIds: this.recipientsForWorkOrder(workOrder),
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      type: redistributed ? 'REDISTRIBUICAO' : 'NOVA_ATRIBUICAO',
      title: redistributed ? 'Solicitação redistribuída' : 'Nova solicitação',
      message: this.workOrderMessage(workOrder),
      createdByUserId,
    });
  }

  notifyImportantChange(workOrder, description, createdByUserId) {
    return this.create({
      userIds: this.recipientsForWorkOrder(workOrder),
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      type: 'ALTERACAO_IMPORTANTE',
      title: 'Alteração importante',
      message: `${this.workOrderMessage(workOrder)}\n${cleanText(description)}`,
      createdByUserId,
    });
  }

  sendAdministrativeMessage(workOrder, message, createdByUserId) {
    const normalizedMessage = cleanText(message);
    if (!normalizedMessage) return { error: 'Escreva a mensagem administrativa.' };
    if (normalizedMessage.length > 1000) return { error: 'A mensagem administrativa pode ter no máximo 1.000 caracteres.' };
    this.create({
      userIds: this.recipientsForWorkOrder(workOrder),
      requestId: workOrder.request_id,
      workOrderId: workOrder.id,
      type: 'MENSAGEM_ADMINISTRATIVA',
      title: 'Mensagem da Administração',
      message: `${this.workOrderMessage(workOrder)}\n${normalizedMessage}`,
      createdByUserId,
    });
    return { success: true };
  }

  listForUser(userId) {
    const notifications = this.database.prepare(`
      SELECT internal_notifications.*, work_orders.number AS work_order_number, requests.protocol
      FROM internal_notifications
      LEFT JOIN work_orders ON work_orders.id = internal_notifications.work_order_id
      LEFT JOIN requests ON requests.id = internal_notifications.request_id
      WHERE internal_notifications.user_id = ?
      ORDER BY internal_notifications.created_at DESC, internal_notifications.id DESC
      LIMIT 100
    `).all(userId);
    const unreadCount = this.database.prepare('SELECT COUNT(*) AS total FROM internal_notifications WHERE user_id = ? AND read_at IS NULL').get(userId).total;
    return { notifications, unreadCount };
  }

  markRead(notificationId, userId) {
    const result = this.database.prepare('UPDATE internal_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?').run(new Date().toISOString(), Number(notificationId), userId);
    return result.changes > 0;
  }

  markAllRead(userId) {
    this.database.prepare('UPDATE internal_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(new Date().toISOString(), userId);
  }
}

module.exports = { InternalNotificationService, NOTIFICATION_TYPES };
