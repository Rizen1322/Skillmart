const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { query, randomUUID } = require('../config/db');
const { authenticate, requireCustomer } = require('../middleware/auth');

// GET /api/reviews
router.get('/', async (req, res) => {
  try {
    const { executor_id, service_id, page = 1, limit = 10 } = req.query;
    const offset = (Math.max(1, +page) - 1) * +limit;
    const params = []; const conds = [];
    if (executor_id) { params.push(executor_id); conds.push('r.executor_id = ?'); }
    if (service_id)  { params.push(service_id);  conds.push('r.service_id = ?'); }
    params.push(+limit, offset);

    const { rows } = await query(`
      SELECT r.*, u.name AS customer_name, u.avatar AS customer_avatar, s.title AS service_title
      FROM reviews r
      JOIN users u    ON u.id = r.customer_id
      JOIN services s ON s.id = r.service_id
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/reviews
router.post('/', authenticate, requireCustomer,
  body('order_id').isUUID(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().trim().isLength({ max: 1000 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    const { order_id, rating, comment } = req.body;
    try {
      const { rows: [order] } = await query(
        "SELECT * FROM orders WHERE id = ? AND customer_id = ? AND status = 'completed'",
        [order_id, req.user.id]
      );
      if (!order) return res.status(400).json({ error: 'Заказ не найден или не завершён' });

      const { rows: existing } = await query('SELECT id FROM reviews WHERE order_id = ?', [order_id]);
      if (existing.length) return res.status(409).json({ error: 'Отзыв уже оставлен' });

      const id = randomUUID();
      await query(
        'INSERT INTO reviews(id,order_id,service_id,customer_id,executor_id,rating,comment) VALUES(?,?,?,?,?,?,?)',
        [id, order_id, order.service_id, req.user.id, order.executor_id, rating, comment || null]
      );
      await query(
        'INSERT INTO notifications(id,user_id,type,title,data) VALUES(?,?,?,?,?)',
        [randomUUID(), order.executor_id, 'new_review', 'Новый отзыв! ⭐', JSON.stringify({ order_id, rating })]
      );
      const { rows: [review] } = await query('SELECT * FROM reviews WHERE id = ?', [id]);
      res.status(201).json(review);
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
);

module.exports = router;
