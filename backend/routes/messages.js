const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { query, randomUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/:orderId', authenticate, async (req, res) => {
  try {
    const { rows: [order] } = await query(
      'SELECT id FROM orders WHERE id = ? AND (customer_id = ? OR executor_id = ?)',
      [req.params.orderId, req.user.id, req.user.id]
    );
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const { rows } = await query(`
      SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.order_id = ?
      ORDER BY m.created_at ASC
    `, [req.params.orderId]);

    await query(
      'UPDATE messages SET is_read = 1 WHERE order_id = ? AND sender_id != ? AND is_read = 0',
      [req.params.orderId, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /messages:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/:orderId', authenticate,
  body('message').trim().isLength({ min: 1, max: 2000 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    try {
      const { rows: [order] } = await query(
        "SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR executor_id = ?) AND status NOT IN ('completed','cancelled')",
        [req.params.orderId, req.user.id, req.user.id]
      );
      if (!order) return res.status(400).json({ error: 'Нет доступа или заказ завершён' });

      const id = randomUUID();
      await query(
        'INSERT INTO messages(id,order_id,sender_id,message) VALUES(?,?,?,?)',
        [id, req.params.orderId, req.user.id, req.body.message]
      );
      const { rows: [msg] } = await query(
        'SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?', [id]
      );
      const toId = req.user.id === order.customer_id ? order.executor_id : order.customer_id;
      await query(
        'INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
        [randomUUID(), toId, 'new_message', 'Новое сообщение',
         req.body.message.slice(0, 100), JSON.stringify({ order_id: req.params.orderId })]
      );
      res.status(201).json(msg);
    } catch (err) {
      console.error('POST /messages:', err.message);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
);

module.exports = router;
