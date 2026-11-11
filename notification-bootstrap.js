// Auto-install additive SMS schema on first production API request / scheduled run.
// Never resets existing members, passwords, payments or KNUMLO invoice tables.
const { Pool } = require('pg');
const scripts = require('./notification-schema');
let completed = false, pending;
const MIGRATION = 'notification-schema-v2';
async function apply() {
  if (completed) return true;
  if (process.env.CONTEXT && process.env.CONTEXT !== 'production') return false; // previews cannot modify production
  if (!process.env.DATABASE_URL) return false;
  if (pending) return pending;
  pending = (async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false, max: 1,
      connectionTimeoutMillis: 10000 });
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(721911, 41912)');
      await client.query(`CREATE TABLE IF NOT EXISTS knumlo_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      const done = await client.query('SELECT 1 FROM knumlo_schema_migrations WHERE name = $1', [MIGRATION]);
      if (!done.rowCount) {
        // PostgreSQL requires new enum values to be committed before their use in dependent SQL.
        await client.query("ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'rejected'");
        await client.query('BEGIN');
        try {
          for (const script of scripts) await client.query(script);
          await client.query('INSERT INTO knumlo_schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [MIGRATION]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
      completed = true;
      return true;
    } finally {
      try { await client.query('SELECT pg_advisory_unlock(721911, 41912)'); } catch (_) {}
      client.release();
      await pool.end();
    }
  })();
  try { return await pending; } finally { pending = null; }
}
module.exports = { apply };
