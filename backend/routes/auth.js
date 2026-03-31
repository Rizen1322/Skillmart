const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, randomUUID } = require('../config/db');
const { authenticate, generateToken } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register',
  body('name').trim().isLength({ min: 2 }),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['customer', 'executor']),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    const { name, email, password, role } = req.body;
    try {
      const { rows: dup } = await query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
      if (dup.length) return res.status(409).json({ error: 'Email уже используется' });

      const hash = await bcrypt.hash(password, 10);
      const id   = randomUUID();
      await query(
        'INSERT INTO users(id, name, email, password_hash, role) VALUES(?, ?, ?, ?, ?)',
        [id, name.trim(), email.toLowerCase(), hash, role]
      );

      // Create balance row
      await query('INSERT IGNORE INTO balances(user_id, amount) VALUES(?, 0)', [id]);

      const { rows } = await query(
        'SELECT id, name, email, role, avatar, bio, is_active, created_at FROM users WHERE id = ?', [id]
      );
      const user  = rows[0];
      const token = generateToken(user);
      return res.status(201).json({ user, token });
    } catch (err) {
      console.error('Register error:', err.message);
      return res.status(500).json({ error: 'Ошибка регистрации: ' + err.message });
    }
  }
);

// POST /api/auth/login
router.post('/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    const { email, password } = req.body;
    try {
      const { rows } = await query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
      if (!rows.length || !rows[0].is_active)
        return res.status(401).json({ error: 'Неверный email или пароль' });
      const ok = await bcrypt.compare(password, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
      const { password_hash, ...user } = rows[0];
      await query('INSERT IGNORE INTO balances(user_id, amount) VALUES(?, 0)', [user.id]);
      const token = generateToken(user);
      return res.json({ user, token });
    } catch (err) {
      return res.status(500).json({ error: 'Ошибка входа: ' + err.message });
    }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// POST /api/auth/change-password
router.post('/change-password', authenticate,
  body('old_password').notEmpty(),
  body('new_password').isLength({ min: 6 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    try {
      const { rows } = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
      const ok = await bcrypt.compare(req.body.old_password, rows[0].password_hash);
      if (!ok) return res.status(400).json({ error: 'Неверный текущий пароль' });
      const hash = await bcrypt.hash(req.body.new_password, 10);
      await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
      res.json({ message: 'Пароль изменён' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
);

module.exports = router;
