/**
 * Apply schema.sql to MySQL database
 * Usage: node scripts/init-db.js
 * Set DATABASE_URL env var or configure DB_HOST etc.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

function buildConfig() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      host:     u.hostname,
      port:     parseInt(u.port) || 3306,
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
      ssl:      { rejectUnauthorized: false },
      multipleStatements: true,
    };
  }
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME     || 'skillmart',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };
}

async function main() {
  const schemaPath = path.resolve(__dirname, "../schema.sql");

  console.log("📂 Looking for schema at:", schemaPath);

  if (!fs.existsSync(schemaPath)) {
    console.error("❌ schema.sql not found at", schemaPath);

    console.log("📂 Current dir:", __dirname);
    console.log("📂 Files here:", fs.readdirSync(__dirname));
    console.log("📂 Parent files:", fs.readdirSync(path.resolve(__dirname, "..")));

    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, "utf8");

  console.log("🔄 Connecting to MySQL...");

  let conn;
  try {
    conn = await mysql.createConnection(buildConfig());
    console.log("✅ Connected. Applying schema...");

    await conn.query(sql);

    console.log("✅ Schema applied successfully! Database is ready.");
  } catch (e) {
    console.error('❌ FULL ERROR:', e);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}
main();
