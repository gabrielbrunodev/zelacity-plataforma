class ImageRepository {
  constructor(database) {
    this.database = database;
  }

  create({ requestId, workOrderId = null, imageType, photo, uploadedByUserId, createdAt = new Date().toISOString() }) {
    const result = this.database.prepare(`
      INSERT INTO request_images (
        request_id, work_order_id, image_type, storage_path, original_name,
        mime_type, file_size, uploaded_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestId, workOrderId, imageType, photo.storagePath, photo.originalName, photo.mimeType, photo.size, uploadedByUserId, createdAt);
    return this.findById(Number(result.lastInsertRowid));
  }

  createMany(images) {
    return images.map((image) => this.create(image));
  }

  listForRequest(requestId) {
    return this.database.prepare(`
      SELECT request_images.*, users.name AS uploaded_by_name, work_orders.number AS work_order_number
      FROM request_images
      JOIN users ON users.id = request_images.uploaded_by_user_id
      LEFT JOIN work_orders ON work_orders.id = request_images.work_order_id
      WHERE request_images.request_id = ?
      ORDER BY request_images.created_at ASC, request_images.id ASC
    `).all(requestId);
  }

  listForWorkOrder(workOrderId) {
    return this.database.prepare(`
      SELECT request_images.*, users.name AS uploaded_by_name, work_orders.number AS work_order_number
      FROM request_images
      JOIN users ON users.id = request_images.uploaded_by_user_id
      JOIN work_orders ON work_orders.id = request_images.work_order_id
      WHERE request_images.work_order_id = ?
      ORDER BY request_images.created_at ASC, request_images.id ASC
    `).all(workOrderId);
  }

  findById(id) {
    return this.database.prepare(`
      SELECT request_images.*, requests.requester_user_id,
             COALESCE(image_work_order.team_id, request_work_order.team_id) AS team_id,
             image_work_order.number AS work_order_number
      FROM request_images
      JOIN requests ON requests.id = request_images.request_id
      LEFT JOIN work_orders AS image_work_order ON image_work_order.id = request_images.work_order_id
      LEFT JOIN work_orders AS request_work_order ON request_work_order.request_id = requests.id
      WHERE request_images.id = ?
    `).get(id) || null;
  }
}

module.exports = { ImageRepository };
