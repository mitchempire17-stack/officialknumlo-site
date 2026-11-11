// Every 5 minutes: sends any automatic messages (confirmations, notices, reminders) still waiting in the queue.
const { schedule } = require('@netlify/functions');
const { Pool } = require('pg');
const { apply } = require('../../notification-bootstrap');
const { drain } = require('../../outbox');
const sms = require('../../sms');
exports.run = async () => {
  if (process.env.AUTO_SMS_ENABLED !== 'true' || !sms.live() || process.env.AT_ENV === 'sandbox') return { paused: true, reason: 'Enable live SMS with validated provider settings first' };
  await apply();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 });
  try { return await drain(pool, { limit: 150, budgetMs: 20000 }); } finally { await pool.end(); }
};
exports.handler = schedule('*/5 * * * *', async () => { console.log(JSON.stringify(await exports.run())); return { statusCode: 200 }; });
