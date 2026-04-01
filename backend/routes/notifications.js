const router = require('express').Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const { rows } = await query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [req.user.id, limit]
    );
    const { rows: [cnt] } = await query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    res.json({ notifications: rows, unread_count: parseInt(cnt?.count || 0) });
  } catch (err) {
    console.error('GET /notifications:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Все прочитаны' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Удалено' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
