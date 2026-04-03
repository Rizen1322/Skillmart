const router = require('express').Router();
const { query } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// все маршруты требуют авторизации и роли admin
router.use(authenticate, requireAdmin);

// общая статистика платформы
router.get('/stats', async (req, res) => {
  try {
    const { rows: [stats] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer' AND is_active=1) AS customers,
        (SELECT COUNT(*) FROM users WHERE role='executor' AND is_active=1) AS executors,
        (SELECT COUNT(*) FROM users WHERE is_active=0) AS blocked_users,
        (SELECT COUNT(*) FROM services WHERE is_active=1) AS active_services,
        (SELECT COUNT(*) FROM services) AS total_services,
        (SELECT COUNT(*) FROM orders) AS total_orders,
        (SELECT COUNT(*) FROM orders WHERE status='completed') AS completed_orders,
        (SELECT COUNT(*) FROM orders WHERE status='cancelled') AS cancelled_orders,
        (SELECT COUNT(*) FROM orders WHERE status IN ('created','in_progress','review')) AS active_orders,
        (SELECT COUNT(*) FROM reviews) AS total_reviews,
        (SELECT COALESCE(AVG(rating),0) FROM reviews) AS avg_rating,
        (SELECT COALESCE(SUM(amount),0) FROM balances) AS total_balance,
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='deposit') AS total_deposited,
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='payment') AS total_paid,
        (SELECT COUNT(*) FROM users WHERE DATE(created_at) = CURDATE()) AS new_users_today,
        (SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURDATE()) AS new_orders_today
    `);
    res.json(stats);
  } catch (err) {
    console.error('admin stats:', err.message);
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// график регистраций за 30 дней
router.get('/stats/registrations', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT DATE(created_at) AS date, role, COUNT(*) AS count
      FROM users
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at), role
      ORDER BY date ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// заказы по дням за 30 дней
router.get('/stats/orders', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT DATE(created_at) AS date, status, COUNT(*) AS count,
             COALESCE(SUM(total_price),0) AS revenue
      FROM orders
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at), status
      ORDER BY date ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// топ исполнители по заработку и заказам
router.get('/stats/top-executors', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.id, u.name, u.email, u.avatar,
             COUNT(DISTINCT o.id) AS orders_count,
             COUNT(DISTINCT o.id) FILTER_HACK AS completed,
             COALESCE(AVG(r.rating),0) AS avg_rating,
             COUNT(DISTINCT r.id) AS reviews_count,
             COALESCE(b.amount,0) AS balance
      FROM users u
      LEFT JOIN orders o ON o.executor_id=u.id AND o.status='completed'
      LEFT JOIN reviews r ON r.executor_id=u.id
      LEFT JOIN balances b ON b.user_id=u.id
      WHERE u.role='executor' AND u.is_active=1
      GROUP BY u.id, u.name, u.email, u.avatar, b.amount
      ORDER BY orders_count DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch {
    // упрощённый запрос без FILTER
    const { rows } = await query(`
      SELECT u.id, u.name, u.email,
             (SELECT COUNT(*) FROM orders o WHERE o.executor_id=u.id AND o.status='completed') AS completed,
             (SELECT COALESCE(AVG(r.rating),0) FROM reviews r WHERE r.executor_id=u.id) AS avg_rating,
             (SELECT COUNT(*) FROM reviews r WHERE r.executor_id=u.id) AS reviews_count,
             COALESCE(b.amount,0) AS balance
      FROM users u
      LEFT JOIN balances b ON b.user_id=u.id
      WHERE u.role='executor' AND u.is_active=1
      ORDER BY completed DESC, avg_rating DESC
      LIMIT 20
    `);
    res.json(rows);
  }
});

// список пользователей с фильтрацией и поиском
router.get('/users', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const role   = req.query.role   || null;
    const search = req.query.search || null;
    const status = req.query.status || null;

    const params = [];
    const conds  = ['1=1'];
    if (role)   { params.push(role);           conds.push('u.role = ?'); }
    if (status === 'blocked') { conds.push('u.is_active = 0'); }
    else if (status === 'active') { conds.push('u.is_active = 1'); }
    if (search) { params.push(`%${search}%`, `%${search}%`); conds.push('(u.name LIKE ? OR u.email LIKE ?)'); }

    const cntParams = [...params];
    const { rows: cnt } = await query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${conds.join(' AND ')}`, cntParams
    );
    params.push(limit, offset);

    const { rows } = await query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.avatar, u.created_at,
             COALESCE(b.amount,0) AS balance,
             (SELECT COUNT(*) FROM orders o WHERE o.customer_id=u.id OR o.executor_id=u.id) AS orders_count,
             (SELECT COUNT(*) FROM services s WHERE s.executor_id=u.id) AS services_count
      FROM users u
      LEFT JOIN balances b ON b.user_id=u.id
      WHERE ${conds.join(' AND ')}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `, params);

    res.json({ data: rows, pagination: { total: parseInt(cnt[0].total), page, limit } });
  } catch (err) {
    console.error('admin users:', err.message);
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// получить детали одного пользователя
router.get('/users/:id', async (req, res) => {
  try {
    const { rows: [user] } = await query(
      'SELECT id,name,email,role,is_active,avatar,bio,created_at FROM users WHERE id=?', [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'пользователь не найден' });

    const [{ rows: orders }, { rows: services }, { rows: txs }, { rows: revs }] = await Promise.all([
      query(`SELECT o.*, s.title AS service_title FROM orders o
             JOIN services s ON s.id=o.service_id
             WHERE o.customer_id=? OR o.executor_id=?
             ORDER BY o.created_at DESC LIMIT 10`, [req.params.id, req.params.id]),
      query('SELECT id,title,price,rating,orders_count,is_active FROM services WHERE executor_id=? LIMIT 10', [req.params.id]),
      query('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 10', [req.params.id]),
      query('SELECT * FROM reviews WHERE customer_id=? OR executor_id=? ORDER BY created_at DESC LIMIT 10', [req.params.id, req.params.id]),
    ]);

    const { rows: [bal] } = await query('SELECT amount FROM balances WHERE user_id=?', [req.params.id]);
    user.balance = parseFloat(bal?.amount || 0);
    user.orders = orders;
    user.services = services;
    user.transactions = txs;
    user.reviews = revs;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// блокировка / разблокировка пользователя
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'нельзя заблокировать себя' });
    await query('UPDATE users SET is_active = NOT is_active WHERE id=?', [req.params.id]);
    const { rows: [u] } = await query('SELECT id,name,is_active FROM users WHERE id=?', [req.params.id]);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// назначить / убрать роль admin
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['customer','executor','admin'].includes(role)) return res.status(400).json({ error: 'неверная роль' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'нельзя изменить свою роль' });
    await query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    const { rows: [u] } = await query('SELECT id,name,role FROM users WHERE id=?', [req.params.id]);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// скорректировать баланс пользователя (добавить / снять вручную)
router.post('/users/:id/balance', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    const reason = req.body.reason || 'корректировка администратором';
    if (isNaN(amount) || amount === 0) return res.status(400).json({ error: 'укажите сумму' });

    if (amount > 0) {
      await query('INSERT INTO balances(user_id,amount) VALUES(?,?) ON DUPLICATE KEY UPDATE amount=amount+?',
        [req.params.id, amount, amount]);
    } else {
      const { rows: [bal] } = await query('SELECT amount FROM balances WHERE user_id=?', [req.params.id]);
      if (parseFloat(bal?.amount || 0) < Math.abs(amount)) return res.status(400).json({ error: 'недостаточно средств на счёте' });
      await query('UPDATE balances SET amount=amount+? WHERE user_id=?', [amount, req.params.id]);
    }

    const { randomUUID } = require('../config/db');
    await query('INSERT INTO transactions(id,user_id,type,amount,description) VALUES(?,?,?,?,?)',
      [randomUUID(), req.params.id, amount > 0 ? 'deposit' : 'withdrawal', Math.abs(amount), reason]);

    const { rows: [b] } = await query('SELECT amount FROM balances WHERE user_id=?', [req.params.id]);
    res.json({ balance: b?.amount || 0, message: 'баланс обновлён' });
  } catch (err) {
    console.error('admin balance:', err.message);
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// список услуг с фильтрацией
router.get('/services', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const search = req.query.search || null;
    const params = [];
    const conds  = ['1=1'];
    if (search) { params.push(`%${search}%`, `%${search}%`); conds.push('(s.title LIKE ? OR u.name LIKE ?)'); }
    const cntP = [...params];
    const { rows: cnt } = await query(
      `SELECT COUNT(*) AS t FROM services s JOIN users u ON u.id=s.executor_id WHERE ${conds.join(' AND ')}`, cntP
    );
    params.push(limit, offset);
    const { rows } = await query(`
      SELECT s.*, u.name AS executor_name, c.name AS category_name
      FROM services s
      JOIN users u ON u.id=s.executor_id
      JOIN categories c ON c.id=s.category_id
      WHERE ${conds.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `, params);
    res.json({ data: rows, pagination: { total: parseInt(cnt[0].t), page, limit } });
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// включить / выключить услугу
router.patch('/services/:id/toggle', async (req, res) => {
  try {
    await query('UPDATE services SET is_active = NOT is_active WHERE id=?', [req.params.id]);
    const { rows: [s] } = await query('SELECT id,title,is_active FROM services WHERE id=?', [req.params.id]);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// удалить услугу
router.delete('/services/:id', async (req, res) => {
  try {
    await query('DELETE FROM services WHERE id=?', [req.params.id]);
    res.json({ message: 'удалено' });
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// детали заказа для просмотра администратором
router.get('/orders/:id', async (req, res) => {
  try {
    const { rows: [order] } = await query(`
      SELECT o.*, s.title AS service_title,
             cu.name AS customer_name, cu.email AS customer_email,
             ex.name AS executor_name, ex.email AS executor_email
      FROM orders o
      JOIN services s ON s.id = o.service_id
      JOIN users cu ON cu.id = o.customer_id
      JOIN users ex ON ex.id = o.executor_id
      WHERE o.id = ?
    `, [req.params.id]);
    if (!order) return res.status(404).json({ error: 'заказ не найден' });

    const [{ rows: msgs }, { rows: logs }] = await Promise.all([
      query('SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.order_id=? ORDER BY m.created_at ASC', [req.params.id]),
      query('SELECT * FROM order_status_log WHERE order_id=? ORDER BY created_at ASC', [req.params.id]),
    ]);
    order.messages = msgs;
    order.status_log = logs;
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// все заказы с фильтрами
router.get('/orders', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const params = [];
    const conds  = ['1=1'];
    if (status) { params.push(status); conds.push('o.status=?'); }
    const cntP = [...params];
    const { rows: cnt } = await query(
      `SELECT COUNT(*) AS t FROM orders o WHERE ${conds.join(' AND ')}`, cntP
    );
    params.push(limit, offset);
    const { rows } = await query(`
      SELECT o.*, s.title AS service_title,
             cu.name AS customer_name, ex.name AS executor_name
      FROM orders o
      JOIN services s ON s.id=o.service_id
      JOIN users cu ON cu.id=o.customer_id
      JOIN users ex ON ex.id=o.executor_id
      WHERE ${conds.join(' AND ')}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, params);
    res.json({ data: rows, pagination: { total: parseInt(cnt[0].t), page, limit } });
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// все транзакции
router.get('/transactions', async (req, res) => {
  try {
    const limit  = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const { rows } = await query(`
      SELECT t.*, u.name AS user_name, u.email AS user_email
      FROM transactions t
      JOIN users u ON u.id=t.user_id
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// массовое уведомление всем пользователям
router.post('/notify-all', async (req, res) => {
  try {
    const { title, body: msgBody, role } = req.body;
    if (!title) return res.status(400).json({ error: 'укажите заголовок' });
    const conds = role ? `WHERE role='${role}'` : '';
    const { rows: users } = await query(`SELECT id FROM users WHERE is_active=1 ${conds}`);
    const { randomUUID } = require('../config/db');
    for (const u of users) {
      await query('INSERT INTO notifications(id,user_id,type,title,body) VALUES(?,?,?,?,?)',
        [randomUUID(), u.id, 'admin', title, msgBody || null]);
    }
    res.json({ message: `отправлено ${users.length} пользователям` });
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// категории — добавить новую
router.post('/categories', async (req, res) => {
  try {
    const { name, slug, icon, description, sort_order = 99 } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name и slug обязательны' });
    await query('INSERT INTO categories(name,slug,icon,description,sort_order) VALUES(?,?,?,?,?)',
      [name, slug, icon||'📁', description||'', parseInt(sort_order)]);
    const { rows: [cat] } = await query('SELECT * FROM categories WHERE slug=?', [slug]);
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ error: 'ошибка: ' + err.message });
  }
});

// отзывы — удалить жалобный
router.delete('/reviews/:id', async (req, res) => {
  try {
    await query('DELETE FROM reviews WHERE id=?', [req.params.id]);
    res.json({ message: 'отзыв удалён' });
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});


// редактировать услугу (без ограничения по executor_id)
router.put('/services/:id', async (req, res) => {
  try {
    const { title, description, price, deadline, category_id, tags, is_active, is_negotiable } = req.body;
    await query(`UPDATE services SET
      title=?, description=?, price=?, deadline=?, category_id=?,
      tags=?, is_negotiable=?,
      is_active=COALESCE(?,is_active) WHERE id=?`,
      [title, description, parseFloat(price)||1, parseInt(deadline)||1,
       parseInt(category_id), JSON.stringify(tags||[]),
       is_negotiable ? 1 : 0,
       is_active !== undefined ? (is_active?1:0) : null,
       req.params.id]
    );
    const { rows: [svc] } = await query('SELECT * FROM services WHERE id=?', [req.params.id]);
    res.json(svc);
  } catch(err) {
    console.error('admin PUT /services/:id:', err.message);
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

module.exports = router;

// принудительно изменить статус заказа (от имени системы)
router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['created','in_progress','review','completed','cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'неверный статус' });

    const { rows: [order] } = await query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'заказ не найден' });

    await query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    await query(
      'INSERT INTO order_status_log(order_id,old_status,new_status,changed_by,note) VALUES(?,?,?,?,?)',
      [req.params.id, order.status, status, req.user.id, note || 'принудительно изменено администратором']
    );

    // уведомить обе стороны
    const { randomUUID } = require('../config/db');
    for (const uid of [order.customer_id, order.executor_id]) {
      await query('INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
        [randomUUID(), uid, 'admin', '⚠️ Статус заказа изменён администратором',
         `Статус изменён с «${order.status}» на «${status}»${note ? '. Причина: ' + note : ''}`,
         JSON.stringify({ order_id: req.params.id })]);
    }

    // при завершении — выплатить исполнителю
    if (status === 'completed' && order.status !== 'completed') {
      const price = parseFloat(order.total_price);
      await query('INSERT INTO balances(user_id,amount) VALUES(?,?) ON DUPLICATE KEY UPDATE amount=amount+?',
        [order.executor_id, price, price]);
      await query('INSERT INTO transactions(id,user_id,order_id,type,amount,description) VALUES(?,?,?,?,?,?)',
        [randomUUID(), order.executor_id, req.params.id, 'deposit', price, 'выплата по решению администратора']);
    }

    // при отмене — вернуть заказчику (если не было завершения)
    if (status === 'cancelled' && !['completed','cancelled'].includes(order.status)) {
      const price = parseFloat(order.total_price);
      await query('INSERT INTO balances(user_id,amount) VALUES(?,?) ON DUPLICATE KEY UPDATE amount=amount+?',
        [order.customer_id, price, price]);
      await query('INSERT INTO transactions(id,user_id,order_id,type,amount,description) VALUES(?,?,?,?,?,?)',
        [randomUUID(), order.customer_id, req.params.id, 'deposit', price, 'возврат по решению администратора']);
    }

    const { rows: [updated] } = await query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error('admin order status:', err.message);
    res.status(500).json({ error: 'ошибка сервера' });
  }
});

// отправить сообщение в чат заказа от имени системы
router.post('/orders/:id/message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'укажите сообщение' });
    const { randomUUID } = require('../config/db');
    const id = randomUUID();
    // сообщение от имени администратора (sender_id = req.user.id)
    await query('INSERT INTO messages(id,order_id,sender_id,message) VALUES(?,?,?,?)',
      [id, req.params.id, req.user.id, `🛡️ [Администратор]: ${message.trim()}`]);
    res.json({ message: 'отправлено' });
  } catch (err) {
    res.status(500).json({ error: 'ошибка сервера' });
  }
});


