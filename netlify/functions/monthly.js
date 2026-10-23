// Runs daily: creates this month's dues invoices for active members (safe to repeat).
const { schedule } = require('@netlify/functions');
const { Pool } = require('pg');
exports.run = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false, max: 1 });
  try { const r = await pool.query('SELECT generate_monthly_invoices() AS n'); return r.rows[0].n; } finally { await pool.end(); }
};
exports.handler = schedule('@daily', async () => { await exports.run(); return { statusCode: 200 }; });
