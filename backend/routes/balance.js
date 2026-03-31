const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { query, getConnection, randomUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');

// GET /api/balance
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows: [bal] } = await query(
      'SELECT * FROM balances WHERE user_id = ?', [req.user.id]
    );
    const { rows: txs } = await query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.user.id]
    );
    res.json({ balance: bal || { amount: 0 }, transactions: txs });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/balance/deposit
router.post('/deposit', authenticate,
  body('amount').isFloat({ gt: 99 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: 'Минимальная сумма 100 ₽' });
    const { amount } = req.body;
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'INSERT INTO balances(user_id, amount) VALUES(?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
        [req.user.id, amount, amount]
      );
      await conn.execute(
        'INSERT INTO transactions(id,user_id,type,amount,description) VALUES(?,?,?,?,?)',
        [randomUUID(), req.user.id, 'deposit', amount, `Пополнение баланса`]
      );
      await conn.commit();
      const [[bal]] = await conn.execute('SELECT * FROM balances WHERE user_id = ?', [req.user.id]);
      res.json({ balance: bal, message: 'Баланс пополнен' });
    } catch (err) {
      await conn.rollback();
      console.error('deposit:', err.message);
      res.status(500).json({ error: 'Ошибка пополнения' });
    } finally { conn.release(); }
  }
);

module.exports = router;
