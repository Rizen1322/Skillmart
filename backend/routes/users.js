const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { query, randomUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');

// PUT /api/users/me
router.put('/me', authenticate,
  body('name').optional().trim().isLength({ min: 2 }),
  body('bio').optional().isString(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

    const { name, bio, avatar, availability, specialization, hourly_rate,
            response_time, languages, skills, portfolio, socials } = req.body;
    try {
      // Update base user (only non-null fields)
      await query(
        `UPDATE users SET
          name   = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE name END,
          bio    = CASE WHEN ? IS NOT NULL THEN ? ELSE bio END,
          avatar = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE avatar END
         WHERE id = ?`,
        [name||null, name||null, name||null,
         bio??null, bio??null,
         avatar||null, avatar||null, avatar||null,
         req.user.id]
      );

      // Always upsert executor_profiles for socials (both roles)
      const sc = (socials && typeof socials === 'object') ? JSON.stringify(socials) : '{}';

      if (req.user.role === 'executor') {
        let langsJson = '[]';
        if (Array.isArray(languages) && languages.length) langsJson = JSON.stringify(languages);

        await query(`
          INSERT INTO executor_profiles(user_id, availability, specialization, hourly_rate, response_time, languages, skills, portfolio, socials)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            availability   = VALUES(availability),
            specialization = VALUES(specialization),
            hourly_rate    = VALUES(hourly_rate),
            response_time  = VALUES(response_time),
            languages      = VALUES(languages),
            skills         = VALUES(skills),
            portfolio      = VALUES(portfolio),
            socials        = VALUES(socials)
        `, [
          req.user.id,
          availability || 'available',
          specialization || null,
          hourly_rate ? parseFloat(hourly_rate) : null,
          response_time || '< 24 часов',
          langsJson,
          JSON.stringify(Array.isArray(skills) ? skills : []),
          JSON.stringify(Array.isArray(portfolio) ? portfolio : []),
          sc,
        ]);
      } else {
        // Customer: save only socials
        await query(`
          INSERT INTO executor_profiles(user_id, socials)
          VALUES(?, ?)
          ON DUPLICATE KEY UPDATE socials = VALUES(socials)
        `, [req.user.id, sc]);
      }

      const { rows } = await query(
        'SELECT id, name, email, role, avatar, bio FROM users WHERE id = ?', [req.user.id]
      );
      res.json(rows[0]);
    } catch (err) {
      console.error('PUT /users/me:', err.message);
      res.status(500).json({ error: 'Ошибка обновления: ' + err.message });
    }
  }
);

// GET /api/users/me/full
router.get('/me/full', authenticate, async (req, res) => {
  try {
    const { rows: [user] } = await query(
      'SELECT id, name, email, role, avatar, bio, created_at FROM users WHERE id = ?', [req.user.id]
    );
    const { rows: [ep] } = await query(
      'SELECT * FROM executor_profiles WHERE user_id = ?', [req.user.id]
    );
    user.profile = ep || {};

    if (req.user.role === 'executor') {
      const { rows: [stats] } = await query(`
        SELECT
          COUNT(DISTINCT s.id)  AS services_count,
          SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
          COALESCE(AVG(r.rating), 0) AS avg_rating,
          COUNT(DISTINCT r.id) AS reviews_count
        FROM users u
        LEFT JOIN services s ON s.executor_id = u.id
        LEFT JOIN orders o   ON o.executor_id = u.id
        LEFT JOIN reviews r  ON r.executor_id = u.id
        WHERE u.id = ?
      `, [req.user.id]);
      user.stats = stats;
    }
    res.json(user);
  } catch (err) {
    console.error('GET /users/me/full:', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// GET /api/users/:id — public profile
router.get('/:id', async (req, res) => {
  try {
    const { rows: [user] } = await query(
      'SELECT id, name, avatar, bio, role, created_at FROM users WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const { rows: [ep] } = await query(
      'SELECT availability, specialization, hourly_rate, response_time, languages, skills, portfolio, socials FROM executor_profiles WHERE user_id = ?',
      [user.id]
    );
    user.profile = ep || {};

    if (user.role === 'executor') {
      const { rows: [stats] } = await query(`
        SELECT
          COUNT(DISTINCT s.id)  AS services_count,
          SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
          COALESCE(AVG(r.rating), 0) AS avg_rating,
          COUNT(DISTINCT r.id) AS reviews_count
        FROM users u
        LEFT JOIN services s ON s.executor_id = u.id
        LEFT JOIN orders o   ON o.executor_id = u.id
        LEFT JOIN reviews r  ON r.executor_id = u.id
        WHERE u.id = ?
      `, [user.id]);
      user.stats = stats;
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

module.exports = router;
