const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

function buildConfig(uri) {
  const u = new URL(uri);
  return {
    host:     u.hostname,
    port:     parseInt(u.port) || 3306,
    user:     decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    ssl: { rejectUnauthorized: false },
  };
}

const baseConfig = {
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4',
  timezone:           'Z',
  decimalNumbers:     true,
  supportBigNumbers:  true,
  typeCast(field, next) {
    if (field.type === 'JSON') {
      const val = field.string('utf8');
      if (val === null || val === undefined) return null;
      try { return JSON.parse(val); } catch { return val; }
    }
    if (field.type === 'TINY' && field.length === 1) {
      return field.string() === '1';
    }
    return next();
  },
};

const pool = process.env.DATABASE_URL
  ? mysql.createPool({ ...buildConfig(process.env.DATABASE_URL), ...baseConfig })
  : mysql.createPool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME     || 'skillmart',
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
      ...baseConfig,
    });

pool.query('SELECT 1')
  .then(() => console.log('✅ MySQL connected'))
  .catch(e => console.error('❌ MySQL error:', e.message));

/**
 * Sanitize params: convert undefined→null, floats→int for LIMIT/OFFSET,
 * use pool.query() (not execute) to avoid prepared-statement type errors.
 */
const sanitize = (params) => params.map(p => {
  if (p === undefined) return null;
  // mysql2 prepared statements choke on float LIMIT/OFFSET — force integers
  if (typeof p === 'number' && !Number.isInteger(p)) return Math.trunc(p);
  return p;
});

const query = async (sql, params = []) => {
  // Use pool.query (non-prepared) — avoids ER_WRONG_ARGUMENTS with LIMIT/OFFSET
  const [result] = await pool.query(sql, sanitize(params));
  return { rows: result };
};

const getConnection = () => pool.getConnection();

module.exports = { pool, query, getConnection, randomUUID };
