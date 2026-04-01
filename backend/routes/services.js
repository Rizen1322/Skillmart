const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { query, randomUUID } = require('../config/db');
const { authenticate, requireExecutor } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(50, parseInt(req.query.limit) || 12);
    const offset  = (page - 1) * limit;
    const sort    = req.query.sort || 'newest';
    const category = req.query.category || null;
    const search   = req.query.search   || null;
    const min_price = req.query.min_price ? parseFloat(req.query.min_price) : null;
    const max_price = req.query.max_price ? parseFloat(req.query.max_price) : null;

    const params = [];
    const conds  = ['s.is_active = 1', 'u.is_active = 1'];

    if (category)  { params.push(category);   conds.push('c.slug = ?'); }
    if (min_price) { params.push(min_price);  conds.push('s.price >= ?'); }
    if (max_price) { params.push(max_price);  conds.push('s.price <= ?'); }
    if (search) {
      const term = `%${search}%`;
      params.push(term, term, `%${search}%`);
      conds.push(`(s.title LIKE ? OR s.description LIKE ? OR JSON_SEARCH(JSON_EXTRACT(s.tags,'$[*]'), 'one', ?) IS NOT NULL)`);
    }

    const ORDER = {
      rating:     's.rating DESC, s.reviews_count DESC',
      price_asc:  's.price ASC',
      price_desc: 's.price DESC',
      newest:     's.created_at DESC',
    }[sort] || 's.created_at DESC';

    const countParams = [...params];
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM services s
       JOIN users u ON u.id = s.executor_id
       JOIN categories c ON c.id = s.category_id
       WHERE ${conds.join(' AND ')}`, countParams
    );
    const total = parseInt(countRows[0]?.total || 0);

    params.push(limit, offset);
    const { rows } = await query(`
      SELECT
        s.id, s.title, s.price, s.deadline, s.rating, s.reviews_count, s.orders_count,
        s.tags, s.is_active, s.created_at,
        u.id   AS executor_id, u.name AS executor_name, u.avatar AS executor_avatar,
        c.id   AS category_id, c.name AS category_name,
        c.slug AS category_slug, c.icon AS category_icon
      FROM services s
      JOIN users u ON u.id = s.executor_id
      JOIN categories c ON c.id = s.category_id
      WHERE ${conds.join(' AND ')}
      ORDER BY ${ORDER}
      LIMIT ? OFFSET ?
    `, params);

    res.json({ data: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) || 0 } });
  } catch (err) {
    console.error('GET /services:', err.message);
    res.status(500).json({ error: 'Ошибка загрузки услуг' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        s.id, s.title, s.description, s.price, s.deadline, s.rating,
        s.reviews_count, s.orders_count, s.tags, s.is_active, s.created_at,
        u.id         AS executor_id,
        u.name       AS executor_name,
        u.avatar     AS executor_avatar,
        u.bio        AS executor_bio,
        u.created_at AS executor_since,
        c.id   AS category_id, c.name AS category_name,
        c.slug AS category_slug, c.icon AS category_icon,
        (SELECT COUNT(*) FROM orders o2 WHERE o2.executor_id = u.id AND o2.status = 'completed') AS executor_completed,
        (SELECT COUNT(*) FROM reviews r2 WHERE r2.executor_id = u.id)                            AS executor_reviews,
        (SELECT COALESCE(AVG(r2.rating), 0) FROM reviews r2 WHERE r2.executor_id = u.id)        AS executor_rating,
        (SELECT COUNT(*) FROM services s2 WHERE s2.executor_id = u.id AND s2.is_active = 1)     AS executor_services,
        ep.availability, ep.specialization, ep.hourly_rate, ep.response_time,
        ep.languages, ep.skills, ep.portfolio, ep.socials
      FROM services s
      JOIN users u ON u.id = s.executor_id
      JOIN categories c ON c.id = s.category_id
      LEFT JOIN executor_profiles ep ON ep.user_id = u.id
      WHERE s.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Услуга не найдена' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /services/:id:', err.message);
    res.status(500).json({ error: 'Ошибка загрузки услуги' });
  }
});

router.post('/', authenticate, requireExecutor,
  body('title').trim().isLength({ min: 10 }),
  body('description').trim().isLength({ min: 30 }),
  body('price').isFloat({ gt: 0 }),
  body('deadline').isInt({ gt: 0 }),
  body('category_id').isInt(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });
    try {
      const { title, description, price, deadline, category_id, tags = [] } = req.body;
      const id = randomUUID();
      await query(
        'INSERT INTO services(id,executor_id,category_id,title,description,price,deadline,tags) VALUES(?,?,?,?,?,?,?,?)',
        [id, req.user.id, parseInt(category_id), title, description, parseFloat(price), parseInt(deadline), JSON.stringify(tags)]
      );
      const { rows } = await query('SELECT * FROM services WHERE id = ?', [id]);
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('POST /services:', err.message);
      res.status(500).json({ error: 'Ошибка создания услуги' });
    }
  }
);

router.put('/:id', authenticate, requireExecutor, async (req, res) => {
  try {
    const { title, description, price, deadline, category_id, tags = [], is_active } = req.body;
    const { rows: check } = await query(
      'SELECT id FROM services WHERE id = ? AND executor_id = ?', [req.params.id, req.user.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Услуга не найдена или нет доступа' });
    await query(
      `UPDATE services SET title=?, description=?, price=?, deadline=?, category_id=?, tags=?,
       is_active=COALESCE(?,is_active) WHERE id=?`,
      [title, description, parseFloat(price), parseInt(deadline), parseInt(category_id),
       JSON.stringify(tags), is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id]
    );
    const { rows } = await query('SELECT * FROM services WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

router.delete('/:id', authenticate, requireExecutor, async (req, res) => {
  try {
    const { rows } = await query(
      'DELETE FROM services WHERE id = ? AND executor_id = ?', [req.params.id, req.user.id]
    );
    if (rows.affectedRows === 0) return res.status(404).json({ error: 'Услуга не найдена' });
    res.json({ message: 'Удалено' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
