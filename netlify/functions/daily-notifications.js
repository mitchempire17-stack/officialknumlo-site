// Every day at 08:00 Nairobi time: creates the month's dues invoices and queues the dues notice (1st of the month)
// or reminders (REMINDER_DAYS, default 10 and 20). Nothing is queued until PAYBILL_NUMBER is set.
const { schedule } = require('@netlify/functions');
const { Pool } = require('pg');
const { apply } = require('../../notification-bootstrap');
exports.run = async () => {
  const E = process.env;
  if (E.AUTO_SMS_ENABLED !== 'true' || E.REMINDERS !== 'on') return { queued: 0, note: 'reminders switched off' };
  await apply();
  const pool = new Pool({ connectionString: E.DATABASE_URL, ssl: E.PGSSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 });
  try {
    if (E.AUTO_SMS_ENABLED !== 'true' || E.REMINDERS !== 'on') return { queued: 0, note: 'reminders switched off' };
    const days = String(E.REMINDER_DAYS || '10,20').split(',').map(Number).filter(n => n >= 2 && n <= 28);
    if (!/^\d{5,7}$/.test(String(E.PAYBILL_NUMBER || ''))) return { queued: 0, note: 'A valid Paybill is required' };
    const r = await pool.query('SELECT queue_dues_reminders($1, $2::int[]) AS n', [E.PAYBILL_NUMBER || '', days]);
    return { queued: r.rows[0].n, note: E.PAYBILL_NUMBER ? '' : 'PAYBILL_NUMBER not set: no reminders queued' };
  } finally { await pool.end(); }
};
exports.handler = schedule('0 5 * * *', async () => { console.log(JSON.stringify(await exports.run())); return { statusCode: 200 }; });
