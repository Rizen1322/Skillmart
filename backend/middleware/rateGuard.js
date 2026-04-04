// защита от абьюза: лимиты на регистрацию с одного IP,
// спам услугами, накрутку отзывов и тд

const { query } = require('../config/db');

// карта попыток в памяти (в продакшне лучше redis, но для free-tier сойдёт)
const attempts = new Map();

// сбрасываем старые записи каждые 10 минут
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of attempts) {
    if (val.firstAt < cutoff) attempts.delete(key);
  }
}, 10 * 60 * 1000);

function trackAttempt(key, limit, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, firstAt: now };
  if (now - entry.firstAt > windowMs) {
    // окно сбросилось
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count++;
  attempts.set(key, entry);
  return entry.count > limit;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

// не более 3 регистраций с одного IP за 1 час
const regGuard = (req, res, next) => {
  const ip = getIP(req);
  if (trackAttempt(`reg:${ip}`, 3, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Слишком много попыток регистрации. Попробуйте позже.' });
  }
  next();
};

// не более 5 услуг в день с одного аккаунта
const svcCreateGuard = async (req, res, next) => {
  if (!req.user) return next();
  try {
    const { rows: [cnt] } = await query(`
      SELECT COUNT(*) AS c FROM services
      WHERE executor_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
    `, [req.user.id]);
    if (parseInt(cnt.c) >= 5) {
      return res.status(429).json({ error: 'Можно создать не более 5 услуг в сутки' });
    }
    next();
  } catch { next(); }
};

// не более 20 сообщений в минуту в чат
const msgGuard = (req, res, next) => {
  if (!req.user) return next();
  const key = `msg:${req.user.id}`;
  if (trackAttempt(key, 20, 60 * 1000)) {
    return res.status(429).json({ error: 'Слишком много сообщений. Подождите немного.' });
  }
  next();
};

// не более 5 заказов в час с одного аккаунта (против накрутки)
const orderGuard = async (req, res, next) => {
  if (!req.user) return next();
  try {
    const { rows: [cnt] } = await query(`
      SELECT COUNT(*) AS c FROM orders
      WHERE customer_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `, [req.user.id]);
    if (parseInt(cnt.c) >= 5) {
      return res.status(429).json({ error: 'Не более 5 заказов в час. Подождите немного.' });
    }
    next();
  } catch { next(); }
};

module.exports = { regGuard, svcCreateGuard, msgGuard, orderGuard };
