const router = require('express').Router();
const { query } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/admin/stats
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows: [stats] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer') AS customers,
        (SELECT COUNT(*) FROM users WHERE role='executor') AS executors,
        (SELECT COUNT(*) FROM services WHERE is_active=1)  AS services,
        (SELECT COUNT(*) FROM orders)                       AS orders,
        (SELECT COUNT(*) FROM orders WHERE status='completed') AS completed,
        (SELECT COALESCE(SUM(amount),0) FROM balances)     AS total_balance
    `);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/admin/users
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id,name,email,role,is_active,created_at FROM users ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PATCH /api/admin/users/:id/toggle
router.patch('/users/:id/toggle', authenticate, requireAdmin, async (req, res) => {
  try {
    await query('UPDATE users SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    const { rows: [user] } = await query('SELECT id,name,is_active FROM users WHERE id = ?', [req.params.id]);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
