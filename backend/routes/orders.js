const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { query, getConnection, randomUUID } = require('../config/db');
const { authenticate, requireCustomer } = require('../middleware/auth');

const fmt = n => new Intl.NumberFormat('ru-RU').format(n);

const TRANSITIONS = {
  customer: { created:['cancelled'], in_progress:['review'], review:['completed'], completed:[], cancelled:[] },
  executor: { created:['in_progress','cancelled'], in_progress:['review'], review:[], completed:[], cancelled:[] },
};
const canTransition = (role, from, to) => TRANSITIONS[role]?.[from]?.includes(to) ?? false;

// GET /api/orders
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, +page) - 1) * +limit;
    const isC    = req.user.role === 'customer';
    const params = [req.user.id];
    let where    = isC ? 'o.customer_id = ?' : 'o.executor_id = ?';
    if (status) { params.push(status); where += ' AND o.status = ?'; }
    params.push(+limit, offset);

    const { query } = require("../config/db");
    const { rows } = await query(`
      SELECT o.*, s.title AS service_title,
             cu.name AS customer_name, cu.avatar AS customer_avatar,
             ex.name AS executor_name, ex.avatar AS executor_avatar
      FROM orders o
      JOIN services s  ON s.id  = o.service_id
      JOIN users cu    ON cu.id = o.customer_id
      JOIN users ex    ON ex.id = o.executor_id
      WHERE ${where}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, params);
    res.json({ data: rows, pagination: { total: rows.length, page: +page, limit: +limit } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/orders/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await (require('../config/db').query)(`
      SELECT o.*, s.title AS service_title, s.price AS service_price,
             cu.name AS customer_name, cu.avatar AS customer_avatar,
             ex.name AS executor_name, ex.avatar AS executor_avatar
      FROM orders o
      JOIN services s ON s.id  = o.service_id
      JOIN users cu   ON cu.id = o.customer_id
      JOIN users ex   ON ex.id = o.executor_id
      WHERE o.id = ? AND (o.customer_id = ? OR o.executor_id = ?)
    `, [req.params.id, req.user.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Заказ не найден' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/orders
router.post('/', authenticate, requireCustomer,
  body('service_id').isUUID(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: 'Неверный ID услуги' });
    const { service_id, requirements } = req.body;
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const [[svc]] = await conn.execute('SELECT * FROM services WHERE id = ? AND is_active = 1', [service_id]);
      if (!svc) { await conn.rollback(); return res.status(404).json({ error: 'Услуга не найдена' }); }
      if (svc.executor_id === req.user.id) { await conn.rollback(); return res.status(400).json({ error: 'Нельзя заказать свою услугу' }); }

      const [[bal]] = await conn.execute('SELECT amount FROM balances WHERE user_id = ?', [req.user.id]);
      const balance = parseFloat(bal?.amount || 0);
      if (balance < parseFloat(svc.price)) {
        await conn.rollback();
        return res.status(400).json({
          error: `Недостаточно средств. Баланс: ${fmt(balance)} ₽, нужно: ${fmt(svc.price)} ₽`,
          need_balance: true, required: svc.price, current: balance,
        });
      }

      await conn.execute('UPDATE balances SET amount = amount - ? WHERE user_id = ?', [svc.price, req.user.id]);
      const txId = randomUUID();
      await conn.execute(
        'INSERT INTO transactions(id,user_id,type,amount,description) VALUES(?,?,?,?,?)',
        [txId, req.user.id, 'payment', svc.price, `Оплата заказа: ${svc.title}`]
      );

      const orderId = randomUUID();
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + svc.deadline);
      await conn.execute(
        'INSERT INTO orders(id,service_id,customer_id,executor_id,total_price,deadline_date,requirements) VALUES(?,?,?,?,?,?,?)',
        [orderId, service_id, req.user.id, svc.executor_id, svc.price,
         deadline.toISOString().slice(0,10), requirements || null]
      );
      await conn.execute('UPDATE services SET orders_count = orders_count + 1 WHERE id = ?', [service_id]);
      await conn.execute(
        'INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
        [randomUUID(), svc.executor_id, 'order_created', '📦 Новый заказ!',
         `Заказ на «${svc.title}»`, JSON.stringify({ order_id: orderId })]
      );
      await conn.commit();

      const [[order]] = await conn.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
      res.status(201).json(order);
    } catch (err) {
      await conn.rollback();
      console.error('POST /orders:', err.message);
      res.status(500).json({ error: 'Ошибка создания заказа' });
    } finally { conn.release(); }
  }
);

// PATCH /api/orders/:id/price
router.patch('/:id/price', authenticate,
  body('price').isFloat({ gt: 0 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: 'Укажите корректную цену' });
    const { price, note } = req.body;
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const [[order]] = await conn.execute(
        'SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR executor_id = ?)',
        [req.params.id, req.user.id, req.user.id]
      );
      if (!order) { await conn.rollback(); return res.status(404).json({ error: 'Заказ не найден' }); }
      if (!['created','in_progress'].includes(order.status)) {
        await conn.rollback(); return res.status(400).json({ error: 'Изменить цену можно только в активном заказе' });
      }

      const isCustomer = req.user.id === order.customer_id;
      const diff       = parseFloat(price) - parseFloat(order.total_price);

      if (isCustomer && diff > 0) {
        const [[bal]] = await conn.execute('SELECT amount FROM balances WHERE user_id = ?', [req.user.id]);
        if (parseFloat(bal?.amount || 0) < diff) {
          await conn.rollback(); return res.status(400).json({ error: 'Недостаточно средств для доплаты' });
        }
        await conn.execute('UPDATE balances SET amount = amount - ? WHERE user_id = ?', [diff, req.user.id]);
        await conn.execute('INSERT INTO transactions(id,user_id,type,amount,description) VALUES(?,?,?,?,?)',
          [randomUUID(), req.user.id, 'payment', diff, 'Доплата по заказу']);
      } else if (isCustomer && diff < 0) {
        await conn.execute('UPDATE balances SET amount = amount + ? WHERE user_id = ?', [Math.abs(diff), req.user.id]);
        await conn.execute('INSERT INTO transactions(id,user_id,type,amount,description) VALUES(?,?,?,?,?)',
          [randomUUID(), req.user.id, 'deposit', Math.abs(diff), 'Возврат по заказу']);
      }

      await conn.execute('UPDATE orders SET total_price = ? WHERE id = ?', [price, order.id]);

      const notifyId = isCustomer ? order.executor_id : order.customer_id;
      const whoName  = isCustomer ? 'Заказчик' : 'Исполнитель';
      await conn.execute('INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
        [randomUUID(), notifyId, 'price_changed', '💰 Цена изменена',
         `${whoName} изменил цену на ${fmt(price)} ₽${note ? ' — ' + note : ''}`,
         JSON.stringify({ order_id: order.id })]);
      await conn.execute('INSERT INTO messages(id,order_id,sender_id,message) VALUES(?,?,?,?)',
        [randomUUID(), order.id, req.user.id,
         `💰 ${whoName} изменил цену: ${fmt(parseFloat(order.total_price))} → ${fmt(parseFloat(price))} ₽${note ? ' (' + note + ')' : ''}`]);
      await conn.commit();
      res.json({ message: 'Цена обновлена', new_price: price });
    } catch (err) {
      await conn.rollback();
      console.error('PATCH price:', err.message);
      res.status(500).json({ error: 'Ошибка изменения цены' });
    } finally { conn.release(); }
  }
);

// PATCH /api/orders/:id/status
router.patch('/:id/status', authenticate,
  body('status').isIn(['in_progress','review','completed','cancelled']),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: 'Неверный статус' });
    const { status: newStatus, note } = req.body;
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      const [[order]] = await conn.execute(
        'SELECT * FROM orders WHERE id = ? AND (customer_id = ? OR executor_id = ?)',
        [req.params.id, req.user.id, req.user.id]
      );
      if (!order) { await conn.rollback(); return res.status(404).json({ error: 'Заказ не найден' }); }
      if (!canTransition(req.user.role, order.status, newStatus)) {
        await conn.rollback(); return res.status(400).json({ error: `Переход ${order.status} → ${newStatus} недопустим` });
      }

      await conn.execute('UPDATE orders SET status = ? WHERE id = ?', [newStatus, order.id]);
      await conn.execute(
        'INSERT INTO order_status_log(order_id,old_status,new_status,changed_by,note) VALUES(?,?,?,?,?)',
        [order.id, order.status, newStatus, req.user.id, note || null]
      );

      if (newStatus === 'completed') {
        const price = parseFloat(order.total_price);
        await conn.execute(
          'INSERT INTO balances(user_id,amount) VALUES(?,?) ON DUPLICATE KEY UPDATE amount = amount + ?',
          [order.executor_id, price, price]
        );
        await conn.execute('INSERT INTO transactions(id,user_id,order_id,type,amount,description) VALUES(?,?,?,?,?,?)',
          [randomUUID(), order.executor_id, order.id, 'deposit', price, 'Оплата за выполненный заказ']);
        await conn.execute('INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
          [randomUUID(), order.executor_id, 'payment_received', '💰 Оплата получена!',
           `Зачислено ${fmt(price)} ₽`, JSON.stringify({ order_id: order.id })]);
      }

      if (newStatus === 'cancelled' && order.status !== 'completed') {
        const price = parseFloat(order.total_price);
        await conn.execute(
          'INSERT INTO balances(user_id,amount) VALUES(?,?) ON DUPLICATE KEY UPDATE amount = amount + ?',
          [order.customer_id, price, price]
        );
        await conn.execute('INSERT INTO transactions(id,user_id,order_id,type,amount,description) VALUES(?,?,?,?,?,?)',
          [randomUUID(), order.customer_id, order.id, 'deposit', price, 'Возврат за отменённый заказ']);
        await conn.execute('INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
          [randomUUID(), order.customer_id, 'payment_received', '↩️ Возврат средств',
           `Возвращено ${fmt(price)} ₽`, JSON.stringify({ order_id: order.id })]);
      }

      const notifyId = req.user.id === order.customer_id ? order.executor_id : order.customer_id;
      await conn.execute('INSERT INTO notifications(id,user_id,type,title,body,data) VALUES(?,?,?,?,?,?)',
        [randomUUID(), notifyId, 'order_accepted', 'Статус заказа изменён',
         `«${order.status}» → «${newStatus}»`, JSON.stringify({ order_id: order.id })]);

      await conn.commit();
      const [[updated]] = await conn.execute('SELECT * FROM orders WHERE id = ?', [order.id]);
      res.json(updated);
    } catch (err) {
      await conn.rollback();
      console.error('PATCH status:', err.message);
      res.status(500).json({ error: 'Ошибка изменения статуса' });
    } finally { conn.release(); }
  }
);

module.exports = router;
