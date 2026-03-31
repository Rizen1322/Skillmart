const jwt    = require('jsonwebtoken');
const { query } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'skillmart_secret_change_me';

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ error: 'Требуется авторизация' });
    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await query(
      'SELECT id, name, email, role, avatar FROM users WHERE id = ? AND is_active = 1',
      [payload.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Пользователь не найден' });
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role))
    return res.status(403).json({ error: 'Доступ запрещён' });
  next();
};

const requireCustomer = requireRole('customer');
const requireExecutor  = requireRole('executor');
const requireAdmin     = requireRole('admin');

const generateToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

module.exports = { authenticate, requireRole, requireCustomer, requireExecutor, requireAdmin, generateToken };
