// маршруты технического обслуживания
// /api/maintenance/* — только для admin или внутреннего крона (secret key)

const router = require('express').Router();
const { query, pool, randomUUID } = require('../config/db');

const CRON_SECRET = process.env.CRON_SECRET || '4f9a7E!2#d98B_zQx91mPqW_L0k8V_rS6tU5yX_iO4nE3mC2vB1aZ9lK8jH7gF6';

// проверяем либо admin JWT, либо секретный ключ в заголовке
const cronAuth = (req, res, next) => {
  const secret = req.headers['x-cron-secret'];
  if (secret === CRON_SECRET) return next();
  // иначе проверяем JWT admin
  const { authenticate, requireAdmin } = require('../middleware/auth');
  authenticate(req, res, () => requireAdmin(req, res, next));
};

// POST /api/maintenance/cleanup — запустить очистку
router.post('/cleanup', cronAuth, async (req, res) => {
  const log = [];
  const track = (msg, n) => { log.push(`${msg}: ${n}`); console.log(`[maintenance] ${msg}: ${n}`); };

  try {
    // --- отменённые заказы старше 90 дней ---
    const { rows: oldOrders } = await query(`
      SELECT id FROM orders
      WHERE status = 'cancelled'
      AND updated_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);
    if (oldOrders.length) {
      const ids = oldOrders.map(o => `'${o.id}'`).join(',');
      const { rows: m } = await query(`DELETE FROM messages         WHERE order_id IN (${ids})`);
      const { rows: l } = await query(`DELETE FROM order_status_log WHERE order_id IN (${ids})`);
      const { rows: t } = await query(`UPDATE transactions SET order_id = NULL WHERE order_id IN (${ids})`);
      const { rows: o } = await query(`DELETE FROM orders           WHERE id IN (${ids})`);
      track('отменённые заказы (90+ дней)', o.affectedRows);
    } else {
      track('отменённые заказы (90+ дней)', 0);
    }

    // --- деактивированные аккаунты старше 30 дней ---
    const { rows: deadUsers } = await query(`
      SELECT id FROM users
      WHERE is_active = 0
      AND updated_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    if (deadUsers.length) {
      const uids = deadUsers.map(u => `'${u.id}'`).join(',');
      await query(`DELETE FROM notifications    WHERE user_id IN (${uids})`);
      await query(`DELETE FROM balances         WHERE user_id IN (${uids})`);
      await query(`DELETE FROM executor_profiles WHERE user_id IN (${uids})`);
      // не удаляем транзакции — финансовая история важна
      await query(`UPDATE transactions SET user_id = NULL WHERE user_id IN (${uids})`);
      // скрываем услуги
      await query(`UPDATE services SET is_active = 0 WHERE executor_id IN (${uids})`);
      const { rows: du } = await query(`DELETE FROM users WHERE id IN (${uids})`);
      track('удалённые аккаунты (30+ дней деактивации)', du.affectedRows);
    } else {
      track('удалённые аккаунты (30+ дней деактивации)', 0);
    }

    // --- уведомления старше 60 дней ---
    const { rows: dn } = await query(`
      DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)
    `);
    track('старые уведомления (60+ дней)', dn.affectedRows);

    // --- прочитанные уведомления старше 7 дней ---
    const { rows: dnr } = await query(`
      DELETE FROM notifications WHERE is_read = 1 AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    track('прочитанные уведомления (7+ дней)', dnr.affectedRows);

    // --- сообщения в закрытых заказах старше 180 дней ---
    const { rows: dm } = await query(`
      DELETE m FROM messages m
      JOIN orders o ON o.id = m.order_id
      WHERE o.status IN ('completed','cancelled')
      AND m.created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
    `);
    track('старые сообщения (180+ дней)', dm.affectedRows);

    // --- "мёртвые" услуги без заказов старше 365 дней и is_active=0 ---
    const { rows: ds } = await query(`
      DELETE s FROM services s
      WHERE s.is_active = 0
      AND s.created_at < DATE_SUB(NOW(), INTERVAL 365 DAY)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.service_id = s.id)
    `);
    track('мёртвые услуги (365+ дней, неактивны)', ds.affectedRows);

    // --- статистика БД ---
    const { rows: [dbStats] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM users)         AS total_users,
        (SELECT COUNT(*) FROM services)      AS total_services,
        (SELECT COUNT(*) FROM orders)        AS total_orders,
        (SELECT COUNT(*) FROM messages)      AS total_messages,
        (SELECT COUNT(*) FROM notifications) AS total_notifications,
        (SELECT COUNT(*) FROM transactions)  AS total_transactions
    `);

    res.json({ ok: true, log, db_stats: dbStats, timestamp: new Date().toISOString() });
  } catch(err) {
    console.error('[maintenance] ошибка:', err.message);
    res.status(500).json({ ok: false, error: err.message, log });
  }
});

// GET /api/maintenance/stats — размер БД и здоровье
router.get('/stats', cronAuth, async (req, res) => {
  try {
    const { rows: [counts] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM users)                           AS users,
        (SELECT COUNT(*) FROM users WHERE is_active=0)        AS inactive_users,
        (SELECT COUNT(*) FROM services)                        AS services,
        (SELECT COUNT(*) FROM services WHERE is_active=0)     AS hidden_services,
        (SELECT COUNT(*) FROM orders)                          AS orders,
        (SELECT COUNT(*) FROM orders WHERE status='cancelled') AS cancelled_orders,
        (SELECT COUNT(*) FROM orders WHERE status='completed') AS completed_orders,
        (SELECT COUNT(*) FROM messages)                        AS messages,
        (SELECT COUNT(*) FROM notifications)                   AS notifications,
        (SELECT COUNT(*) FROM notifications WHERE is_read=0)   AS unread_notifications,
        (SELECT COUNT(*) FROM transactions)                    AS transactions,
        (SELECT COUNT(*) FROM reviews)                         AS reviews
    `);

    // топ спамеров — больше всего услуг без заказов
    const { rows: suspiciousExecutors } = await query(`
      SELECT u.id, u.name, u.email, COUNT(s.id) AS services_count,
             SUM(s.orders_count) AS total_orders,
             u.created_at
      FROM users u
      JOIN services s ON s.executor_id = u.id
      WHERE u.is_active = 1
      GROUP BY u.id
      HAVING services_count > 10 AND total_orders = 0
      ORDER BY services_count DESC
      LIMIT 10
    `);

    // дублирующиеся email-домены (признак массовой регистрации)
    const { rows: domainStats } = await query(`
      SELECT SUBSTRING_INDEX(email, '@', -1) AS domain, COUNT(*) AS cnt
      FROM users
      WHERE is_active = 1
      GROUP BY domain
      HAVING cnt > 5
      ORDER BY cnt DESC
      LIMIT 10
    `);

    // pending cancellations (отменены, но деньги ещё не вернули — аномалии)
    const { rows: anomalies } = await query(`
      SELECT o.id, o.total_price, o.status, o.updated_at
      FROM orders o
      WHERE o.status = 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.order_id = o.id AND t.type = 'deposit'
      )
      AND o.total_price > 0
      LIMIT 20
    `);

    res.json({ counts, suspicious_executors: suspiciousExecutors, domain_stats: domainStats, payment_anomalies: anomalies });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/maintenance/fix-balances — пересчитать балансы по транзакциям (на случай расхождений)
router.post('/fix-balances', cronAuth, async (req, res) => {
  try {
    // для каждого пользователя считаем баланс из транзакций и сравниваем
    const { rows: users } = await query('SELECT id FROM users WHERE is_active = 1');
    let fixed = 0;
    for (const u of users) {
      const { rows: [calc] } = await query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN type IN ('payment','withdrawal') THEN amount ELSE 0 END), 0)
          AS calculated
        FROM transactions WHERE user_id = ?
      `, [u.id]);
      const { rows: [bal] } = await query('SELECT amount FROM balances WHERE user_id = ?', [u.id]);
      const calculated = parseFloat(calc?.calculated || 0);
      const actual     = parseFloat(bal?.amount || 0);
      // если расхождение больше 1 копейки — фиксируем
      if (Math.abs(calculated - actual) > 0.01) {
        await query('INSERT INTO balances(user_id,amount) VALUES(?,?) ON DUPLICATE KEY UPDATE amount=?',
          [u.id, Math.max(0, calculated), Math.max(0, calculated)]);
        fixed++;
      }
    }
    res.json({ ok: true, fixed_balances: fixed, checked: users.length });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
