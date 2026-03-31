const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

// Parse DATABASE_URL if provided (Render, Railway, PlanetScale, etc.)
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
  decimalNumbers:     true,   // return DECIMAL as JS number
  supportBigNumbers:  true,
  typeCast(field, next) {
    // auto-parse JSON columns
    if (field.type === 'JSON') {
      const val = field.string('utf8');
      if (val === null || val === undefined) return null;
      try { return JSON.parse(val); } catch { return val; }
    }
    // return TINYINT(1) as boolean
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

// Test on startup
pool.query('SELECT 1')
  .then(() => console.log('✅ MySQL connected'))
  .catch(e => console.error('❌ MySQL error:', e.message));

/**
 * Universal query helper — returns { rows } just like pg
 * For SELECT: rows = array of row objects
 * For INSERT/UPDATE/DELETE: rows = { affectedRows, insertId }
 */
const query = async (sql, params = []) => {
  const [result] = await pool.execute(sql, params);
  return { rows: result };
};

/** Get a connection for manual transactions */
const getConnection = () => pool.getConnection();

module.exports = { pool, query, getConnection, randomUUID };
