const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, randomUUID } = require('../config/db');
const { authenticate, generateToken } = require('../middleware/auth');

const ALLOWED_DOMAINS = [
  'gmail.com','googlemail.com',
  'mail.ru','bk.ru','inbox.ru','list.ru',
  'yandex.ru','yandex.com','ya.ru',
  'icloud.com','me.com','mac.com',
  'outlook.com','hotmail.com','live.com','msn.com',
  'yahoo.com','yahoo.ru',
  'proton.me','protonmail.com',
  'rambler.ru','rambler.com',
  'vk.com','internet.ru','corp.mail.ru',
  'tut.by','mail.com','email.com',
];

const validateEmail = (email) => {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  if (ALLOWED_DOMAINS.includes(domain)) return true;
  // разрешаем корпоративные/студенческие домены с известными TLD
  const tlds = ['.com','.ru','.net','.org','.io','.edu','.co','.dev','.app'];
  return tlds.some(t => domain.endsWith(t)) && domain.includes('.');
};

const validatePassword = (pwd) => {
  if (pwd.length < 8) return 'Пароль должен быть не менее 8 символов';
  if (!/[A-Z]/.test(pwd)) return 'Пароль должен содержать хотя бы одну заглавную букву';
  if (!/[a-z]/.test(pwd)) return 'Пароль должен содержать хотя бы одну строчную букву';
  if (!/[0-9]/.test(pwd)) return 'Пароль должен содержать хотя бы одну цифру';
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) return 'Пароль должен содержать хотя бы один спецсимвол';
  return null;
};

router.post('/register',
  body('name').trim().isLength({ min: 2 }).withMessage('имя слишком короткое'),
  body('email').isEmail().withMessage('некорректный email'),
  body('role').isIn(['customer','executor']).withMessage('неверная роль'),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

    const { name, email, password, role } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Используйте корректный email (gmail, mail.ru, yandex и др.)' });
    }

    const pwdErr = validatePassword(password || '');
    if (pwdErr) return res.status(400).json({ error: pwdErr });

    try {
      const { rows: dup } = await query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
      if (dup.length) return res.status(409).json({ error: 'Email уже используется' });

      const hash = await bcrypt.hash(password, 10);
      const id   = randomUUID();
      await query(
        'INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)',
        [id, name.trim(), email.toLowerCase(), hash, role]
      );
      await query('INSERT IGNORE INTO balances(user_id,amount) VALUES(?,0)', [id]);

      const { rows } = await query(
        'SELECT id,name,email,role,avatar,bio,is_active,created_at FROM users WHERE id=?', [id]
      );
      return res.status(201).json({ user: rows[0], token: generateToken(rows[0]) });
    } catch (err) {
      console.error('register:', err.message);
      return res.status(500).json({ error: 'ошибка регистрации: ' + err.message });
    }
  }
);

router.post('/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    const { email, password } = req.body;
    try {
      const { rows } = await query('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
      if (!rows.length || !rows[0].is_active)
        return res.status(401).json({ error: 'Неверный email или пароль' });
      const ok = await bcrypt.compare(password, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
      const { password_hash, ...user } = rows[0];
      await query('INSERT IGNORE INTO balances(user_id,amount) VALUES(?,0)', [user.id]);
      return res.json({ user, token: generateToken(user) });
    } catch (err) {
      return res.status(500).json({ error: 'ошибка входа: ' + err.message });
    }
  }
);

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.post('/change-password', authenticate,
  body('old_password').notEmpty(),
  body('new_password').isLength({ min: 8 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

    const pwdErr = validatePassword(req.body.new_password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });

    try {
      const { rows } = await query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
      const ok = await bcrypt.compare(req.body.old_password, rows[0].password_hash);
      if (!ok) return res.status(400).json({ error: 'Неверный текущий пароль' });
      const hash = await bcrypt.hash(req.body.new_password, 10);
      await query('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
      res.json({ message: 'пароль изменён' });
    } catch (err) {
      res.status(500).json({ error: 'ошибка сервера' });
    }
  }
);

module.exports = router;
