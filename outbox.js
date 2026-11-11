// Sends queued automatic messages (confirmations, notices, reminders) one by one, a few at a time.
const sms = require('./sms');
async function drain(pool, { limit = 100, concurrency = 10, budgetMs = 20000 } = {}) {
  const started = Date.now();
  const rows = (await pool.query(`UPDATE sms_outbox SET status='sending', attempts = attempts + 1, updated_at = now()
     WHERE id IN (SELECT o.id FROM sms_outbox o JOIN members m ON m.id=o.member_id WHERE NOT m.sms_opt_out AND m.phone=o.phone AND o.attempts < 3 AND (o.status='queued' OR (o.status='sending' AND o.updated_at < now() - interval '5 minutes'))
                  ORDER BY o.id LIMIT $1 FOR UPDATE OF o SKIP LOCKED) RETURNING id, phone, message, attempts`, [limit])).rows;
  let sent = 0, failed = 0, retry = 0, i = 0;
  const sender = sms.senderIds()[0] || null;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++];
      if (Date.now() - started > budgetMs) { await pool.query(`UPDATE sms_outbox SET status='queued', attempts = attempts - 1 WHERE id=$1`, [row.id]); continue; }
      let r;
      try { [r] = await sms.sendMany([row.phone], row.message, { senderId: sender, bulk: false }); }
      catch (e) { r = { ok: false, error: e.message }; }
      if (r.ok) { sent++; await pool.query(`UPDATE sms_outbox SET status='sent', sent_at=now(), provider_message_id=$2, cost=$3, error=NULL, updated_at=now() WHERE id=$1`, [row.id, r.id || null, r.cost || null]); }
      else if (row.attempts < 3) { retry++; await pool.query(`UPDATE sms_outbox SET status='queued', error=$2, updated_at=now() WHERE id=$1`, [row.id, String(r.error || 'failed').slice(0, 200)]); }
      else { failed++; await pool.query(`UPDATE sms_outbox SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [row.id, String(r.error || 'failed').slice(0, 200)]); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return { picked: rows.length, sent, failed, retry };
}
module.exports = { drain };
