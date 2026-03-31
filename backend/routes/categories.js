const router = require('express').Router();
const { query } = require('../config/db');

router.get('/', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM categories ORDER BY sort_order');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
