require('dotenv').config();
const express = require('express'), helmet = require('helmet'), cors = require('cors'), rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), crypto = require('crypto'), { Pool } = require('pg');
const daraja = require('./daraja');
const importer = require('./importer');
const E = process.env;
if (!E.JWT_SECRET || !E.DATABASE_URL) {
  const m = 'JWT_SECRET and DATABASE_URL are required';
  if (require.main === module) { console.error(m); process.exit(1); } else throw new Error(m);
}
const pool = new Pool({ connectionString: E.DATABASE_URL, ssl: E.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: Number(E.PG_POOL_MAX) || (E.NETLIFY ? 2 : 10), idleTimeoutMillis: 10000 });
const db = (t, p) => pool.query(t, p);
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: (E.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean) }));
const smallJson = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === '/api/admin/import' ? next() : smallJson(req, res, next)));   // import route allows a larger file

// ---------- helpers ----------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const sign = (sub, kind, role) => jwt.sign({ sub, kind, role }, E.JWT_SECRET, { expiresIn: '8h' });
const auth = (kind, roles) => (req, res, next) => {
  try {
    const p = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), E.JWT_SECRET);
    if (p.kind !== kind || (roles && !roles.includes(p.role))) return bad(res, 'Not allowed', 403);
    req.user = p; next();
  } catch { bad(res, 'Please sign in', 401); }
};
const audit = (req, action, entity, id, details) => db(
  'INSERT INTO audit_log (actor_type,actor_id,action,entity,entity_id,details,ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [req.user ? req.user.kind : 'system', req.user ? req.user.sub : null, action, entity, id, details || null, (clientIp(req).match(/^[0-9a-f.:]+$/i) ? clientIp(req) : null)]).catch(() => {});
const normPhone = p => { const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(String(p || '').replace(/[\s-]/g, '')); return m ? '+254' + m[1] : null; };
const normEmail = e => { e = String(e || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e : null; };
const normId = s => String(s || '').replace(/\s/g, '').toUpperCase();
const stripKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Works behind Netlify (x-nf-client-connection-ip) and ordinary proxies
const clientIp = req => req.headers['x-nf-client-connection-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
const limiter = (max, mins = 15) => rateLimit({ windowMs: mins * 60000, max, standardHeaders: true, legacyHeaders: false, keyGenerator: clientIp,
  validate: { ip: false, trustProxy: false, xForwardedForHeader: false }, message: { error: 'Too many attempts. Try again later.' } });

async function sendSms(phone, text) {
  if (E.SMS_PROVIDER === 'africastalking' && E.AT_API_KEY) {
    const body = new URLSearchParams({ username: E.AT_USERNAME, to: phone, message: text, ...(E.AT_SENDER_ID ? { from: E.AT_SENDER_ID } : {}) });
    await fetch('https://api.africastalking.com/version1/messaging', { method: 'POST', headers: { apiKey: E.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } else console.log(`[SMS to ${phone}] ${text}`);   // development only
}
async function issueResetToken(memberId, phone, intro) {
  const t = crypto.randomBytes(24).toString('hex');
  await db('INSERT INTO password_resets (member_id, token_hash, expires_at) VALUES ($1,$2, now() + interval \'30 minutes\')', [memberId, crypto.createHash('sha256').update(t).digest('hex')]);
  if (phone) await sendSms(phone, `${intro} ${E.PUBLIC_SITE_URL || ''}/#set_${t} (valid 30 minutes)`);
}
// member row in the shape the website uses
const memberSql = `SELECT m.id, m.first_name AS fn, m.last_name AS ln, m.designation AS ds, m.sector_code AS sec, m.county_id AS co,
  coalesce(e.name, m.workstation, '') AS emp, coalesce(m.workstation,'') AS ws, m.membership_no AS no, m.status AS st, m.phone AS ph,
  m.id_number AS idn, m.email, m.payroll_no AS payroll, m.kmltb_licence_no AS reg, m.registered_at, m.needs_review AS review, m.import_notes AS notes,
  CASE WHEN m.status = 'pending' THEN 'APP-' || upper(substr(m.id::text, 1, 6)) END AS ref
  FROM members m LEFT JOIN employers e ON e.id = m.employer_id`;

// ---------- public ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', wrap(async (req, res) => {
  const p = await db("SELECT amount_kes FROM dues_plans WHERE active ORDER BY effective_from DESC LIMIT 1");
  res.json({ paybill: E.PAYBILL_NUMBER || null, monthlyDues: p.rows[0] ? Number(p.rows[0].amount_kes) : null });
}));

app.post('/api/register', limiter(20, 60), wrap(async (req, res) => {
  const b = req.body || {}, id = normId(b.idNumber), ph = normPhone(b.phone), em = normEmail(b.email);
  const first = String(b.firstName || '').trim(), last = String(b.lastName || '').trim(), sec = String(b.sector || '').toUpperCase();
  if (!first || !last || !/^\d{6,8}$/.test(id) && !/^[A-Z0-9]{6,12}$/.test(id)) return bad(res, 'Check your name and ID or passport number.');
  if (!ph) return bad(res, 'Enter a valid Kenyan phone number.');
  if (!em) return bad(res, 'Enter a valid email address.');
  const s = await db('SELECT employer_rule FROM service_sectors WHERE code=$1', [sec]);
  if (!s.rowCount) return bad(res, 'Choose a service sector.');
  const county = Number(b.countyId) || null;
  let employerId = null;
  if (s.rows[0].employer_rule === 'EMPLOYER') {
    const e = await db('SELECT id FROM employers WHERE sector_code=$1 AND code=$2 AND active', [sec, String(b.employer || '').toUpperCase()]);
    if (!e.rowCount) return bad(res, 'Choose your referral hospital.');
    employerId = e.rows[0].id;
  } else if (s.rows[0].employer_rule === 'COUNTY' && !(county >= 1 && county <= 47)) return bad(res, 'Choose your county.');
  const cadre = await db('SELECT id FROM cadres WHERE name = $1', [b.designation]);
  try {
    const r = await db(`INSERT INTO members (first_name,last_name,id_number,phone,email,designation,cadre_id,sector_code,employer_id,county_id,workstation,status,registered_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',now()) RETURNING id`,
      [first, last, id, ph, em, b.designation || null, cadre.rows[0] ? cadre.rows[0].id : null, sec, employerId, county, (employerId ? String(b.workstation || '') : [b.employer, b.workstation].filter(Boolean).join(' - ')).slice(0, 200)]);
    res.status(201).json({ reference: 'APP-' + r.rows[0].id.slice(0, 6).toUpperCase() });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'A member or application with this ID, phone or email already exists.', 409);
    throw e;
  }
}));

app.get('/api/verify/:token', limiter(120, 15), wrap(async (req, res) => {
  const no = req.params.token.replace(/_/g, '/');
  const r = await db('SELECT * FROM verify_membership($1)', [no]);
  res.json(r.rowCount ? { valid: r.rows[0].valid, number: no.toUpperCase(), sector: r.rows[0].sector } : { valid: false, number: no.toUpperCase() });
}));

app.post('/api/newsletter', limiter(20, 60), wrap(async (req, res) => {
  const em = normEmail(req.body && req.body.email);
  if (!em) return bad(res, 'Enter a valid email address.');
  await db('INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT DO NOTHING', [em]);
  res.json({ ok: true });
}));

// ---------- auth ----------
app.post('/api/auth/login', limiter(15), wrap(async (req, res) => {
  const k = stripKey(req.body && req.body.login), pw = String((req.body && req.body.password) || '');
  const r = await db(`SELECT id, password_hash, failed_logins, locked_until FROM members
    WHERE upper(regexp_replace(id_number,'[^A-Za-z0-9]','','g')) = $1 OR regexp_replace(upper(membership_no),'[^A-Z0-9]','','g') = $1`, [k]);
  const m = r.rows[0];
  if (!m) return bad(res, 'Incorrect details.', 401);
  if (m.locked_until && m.locked_until > new Date()) return bad(res, 'Account temporarily locked. Try again later.', 423);
  if (!m.password_hash) return bad(res, 'Set your password first using "Forgot / first-time login".', 403);
  if (!bcrypt.compareSync(pw, m.password_hash)) {
    await db(`UPDATE members SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins >= 4 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id=$1`, [m.id]);
    return bad(res, 'Incorrect details.', 401);
  }
  await db('UPDATE members SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id=$1', [m.id]);
  res.json({ token: sign(m.id, 'member') });
}));

app.post('/api/auth/staff-login', limiter(10), wrap(async (req, res) => {
  const r = await db('SELECT id, password_hash, role FROM staff_users WHERE lower(email)=lower($1) AND active', [String((req.body && req.body.email) || '')]);
  const s = r.rows[0];
  if (!s || !bcrypt.compareSync(String(req.body.password || ''), s.password_hash)) return bad(res, 'Incorrect details.', 401);
  await db('UPDATE staff_users SET last_login_at = now() WHERE id=$1', [s.id]);
  res.json({ token: sign(s.id, 'staff', s.role), role: s.role });
}));

// First-time login or forgotten password: needs ID number plus the phone or email on record.
app.post('/api/auth/request-reset', limiter(10), wrap(async (req, res) => {
  const b = req.body || {}, id = stripKey(b.idNumber), ph = normPhone(b.phone), em = normEmail(b.email);
  const r = await db(`SELECT id, phone FROM members WHERE status='active' AND upper(regexp_replace(id_number,'[^A-Za-z0-9]','','g')) = $1
    AND (($2::text IS NOT NULL AND phone = $2) OR ($3::text IS NOT NULL AND lower(email) = $3))`, [id, ph, em]);
  if (r.rowCount && r.rows[0].phone) await issueResetToken(r.rows[0].id, r.rows[0].phone, 'KNUMLO: set your password:');
  res.json({ ok: true, message: 'If the details match an approved member, a link has been sent by SMS.' });
}));

app.post('/api/auth/set-password', limiter(10), wrap(async (req, res) => {
  const pw = String((req.body && req.body.password) || ''), h = crypto.createHash('sha256').update(String((req.body && req.body.token) || '')).digest('hex');
  if (pw.length < 8) return bad(res, 'Password must be at least 8 characters.');
  const r = await db('SELECT id, member_id FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()', [h]);
  if (!r.rowCount) return bad(res, 'This link is invalid or has expired.', 400);
  await db('UPDATE members SET password_hash=$1, must_change_password=false, failed_logins=0, locked_until=NULL WHERE id=$2', [bcrypt.hashSync(pw, 12), r.rows[0].member_id]);
  await db('UPDATE password_resets SET used_at = now() WHERE id=$1', [r.rows[0].id]);
  res.json({ ok: true });
}));

// ---------- member ----------
const asMember = auth('member');
app.get('/api/me', asMember, wrap(async (req, res) => {
  const m = (await db(memberSql + ' WHERE m.id=$1', [req.user.sub])).rows[0];
  const b = (await db('SELECT outstanding, total_paid, months_owed, dues_status FROM v_member_balance WHERE member_id=$1', [req.user.sub])).rows[0] || {};
  const p = (await db("SELECT coalesce(sum(amount),0) AS paid, coalesce(sum(unallocated),0) AS credit FROM payments WHERE member_id=$1 AND status='completed'", [req.user.sub])).rows[0];
  res.json({ ...m, credit: Number(p.credit), outstanding: Number(b.outstanding || 0), paidTotal: Number(p.paid), monthsOwed: Number(b.months_owed || 0), duesStatus: b.dues_status });
}));
app.patch('/api/me', asMember, wrap(async (req, res) => {
  const ph = req.body.phone ? normPhone(req.body.phone) : null;
  if (req.body.phone && !ph) return bad(res, 'Enter a valid Kenyan phone number.');
  try {
    await db('UPDATE members SET workstation = coalesce($1, workstation), phone = coalesce($2, phone) WHERE id=$3', [req.body.workstation ? String(req.body.workstation).slice(0, 200) : null, ph, req.user.sub]);
  } catch (e) { if (e.code === '23505') return bad(res, 'That phone number is already registered.', 409); throw e; }
  await audit(req, 'member.updated', 'members', req.user.sub);
  res.json({ ok: true });   // membership number is protected by a database trigger
}));
app.get('/api/me/payments', asMember, wrap(async (req, res) => {
  const r = await db(`SELECT id, to_char(coalesce(completed_at, created_at) AT TIME ZONE 'Africa/Nairobi','DD Mon YYYY') AS date, channel, receipt_no AS reference, provider_ref, amount, status
    FROM payments WHERE member_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.sub]);
  res.json(r.rows);
}));
app.post('/api/payments/stk', asMember, limiter(10, 10), wrap(async (req, res) => {
  const amount = Number(req.body.amount), phone = normPhone(req.body.phone);
  if (!(amount >= 50 && amount <= 150000)) return bad(res, 'Enter an amount between KES 50 and 150,000.');
  if (!phone) return bad(res, 'Enter a valid Safaricom number.');
  const m = (await db('SELECT id, membership_no, membership_serial, status FROM members WHERE id=$1', [req.user.sub])).rows[0];
  if (m.status !== 'active') return bad(res, 'Only approved members can pay dues.', 403);
  const p = (await db("INSERT INTO payments (member_id, channel, status, amount, payer_phone) VALUES ($1,'mpesa_stk','pending',$2,$3) RETURNING id", [m.id, amount, phone])).rows[0];
  try {
    const ref = 'KNUMLO' + String(m.membership_serial).padStart(3, '0');
    const r = await daraja.stkPush({ amount, phone: phone.slice(1), ref, desc: 'Dues' });
    await db('INSERT INTO mpesa_stk_requests (payment_id, merchant_request_id, checkout_request_id, phone, amount, account_reference) VALUES ($1,$2,$3,$4,$5,$6)', [p.id, r.MerchantRequestID, r.CheckoutRequestID, phone, amount, ref]);
    res.json({ paymentId: p.id, message: 'Check your phone and enter your M-Pesa PIN.' });
  } catch (e) {
    await db("UPDATE payments SET status='failed', notes=$2 WHERE id=$1", [p.id, e.message.slice(0, 200)]);
    console.error('STK push failed:', e.message);
    bad(res, 'Could not send the M-Pesa prompt. Please try again or pay via Paybill.', 502);
  }
}));
app.get('/api/payments/:id', asMember, wrap(async (req, res) => {
  const r = await db('SELECT status, receipt_no, provider_ref, notes FROM payments WHERE id=$1 AND member_id=$2', [req.params.id, req.user.sub]);
  r.rowCount ? res.json(r.rows[0]) : bad(res, 'Not found', 404);
}));

// ---------- Safaricom callbacks (secret path segment, no login) ----------
const mp = `/api/mpesa/${E.MPESA_CALLBACK_SECRET || 'disabled-set-MPESA_CALLBACK_SECRET'}`;
const ok = { ResultCode: 0, ResultDesc: 'Accepted' };
app.post(`${mp}/stk`, wrap(async (req, res) => {
  const cb = req.body && req.body.Body && req.body.Body.stkCallback;
  if (cb) {
    const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
    const rec = (items.find(i => i.Name === 'MpesaReceiptNumber') || {}).Value || null;
    await db('SELECT complete_stk($1,$2,$3,$4,$5)', [cb.CheckoutRequestID, cb.ResultCode, cb.ResultDesc, rec, req.body]);
  }
  res.json(ok);
}));
app.post(`${mp}/c2b/validation`, (req, res) => res.json(ok));
app.post(`${mp}/c2b/confirmation`, wrap(async (req, res) => {
  const b = req.body || {}, t = String(b.TransTime || '');
  const when = t.length === 14 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+03` : new Date().toISOString();
  await db('SELECT record_c2b_payment($1,$2,$3,$4,$5,$6,$7)', [b.TransID, when, b.TransAmount, b.BillRefNumber, b.MSISDN, [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' '), b]);
  res.json(ok);
}));

// ---------- officials ----------
const staff = auth('staff'), approvers = auth('staff', ['super_admin', 'secretary']), money = auth('staff', ['super_admin', 'treasurer']);
const officers = auth('staff', ['super_admin', 'secretary', 'treasurer', 'branch_officer']);   // may see personal records
const memberExporters = auth('staff', ['super_admin', 'secretary']), moneyViewers = auth('staff', ['super_admin', 'secretary', 'treasurer']), superOnly = auth('staff', ['super_admin']);
const STATUSES = ['pending', 'active', 'suspended', 'exited', 'rejected'];
function memberFilter(q) {
  const w = [], p = [];
  if (STATUSES.includes(q.status)) { p.push(q.status); w.push(`m.status = $${p.length}::member_status`); }
  if (q.sector) { p.push(String(q.sector).toUpperCase()); w.push(`m.sector_code = $${p.length}`); }
  if (Number(q.county)) { p.push(Number(q.county)); w.push(`m.county_id = $${p.length}`); }
  if (q.review === '1') w.push('m.needs_review');
  if (q.q) { p.push('%' + String(q.q).toLowerCase() + '%'); w.push(`lower(m.first_name || ' ' || m.last_name || ' ' || m.id_number || ' ' || coalesce(m.membership_no,'') || ' ' || coalesce(m.workstation,'')) LIKE $${p.length}`); }
  return { where: w.length ? ' WHERE ' + w.join(' AND ') : '', p };
}
const csvSafe = v => { const t = v == null ? '' : v instanceof Date ? v.toISOString() : String(v); return '"' + (/^[=@]|^[+-](?![0-9])/.test(t) ? "'" + t : t).replace(/"/g, '""') + '"'; };
const sendCsv = (res, name, cols, rows) => res.type('text/csv').set('Content-Disposition', `attachment; filename="${name}"`)
  .send('\ufeff' + [cols.join(',')].concat(rows.map(r => cols.map(c => csvSafe(r[c])).join(','))).join('\n'));

app.get('/api/admin/me', staff, wrap(async (req, res) => {
  const r = await db('SELECT full_name, role FROM staff_users WHERE id=$1 AND active', [req.user.sub]);
  r.rowCount ? res.json({ name: r.rows[0].full_name, role: r.rows[0].role }) : bad(res, 'Please sign in', 401);
}));
app.get('/api/admin/members', officers, wrap(async (req, res) => {
  const { where, p } = memberFilter(req.query), limit = Math.min(Number(req.query.limit) || 50, 200), offset = (Math.max(Number(req.query.page) || 1, 1) - 1) * limit;
  const total = (await db(`SELECT count(*) FROM members m${where}`, p)).rows[0].count;
  const rows = (await db(`${memberSql}${where} ORDER BY m.registered_at NULLS LAST, m.created_at LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  res.json({ total: Number(total), rows });
}));
app.get('/api/admin/stats', staff, wrap(async (req, res) => {
  const r = await db(`SELECT m.status, m.sector_code AS sec, c.name AS county, count(*)::int AS n FROM members m LEFT JOIN counties c ON c.id = m.county_id GROUP BY 1,2,3`);
  const out = { total: 0, active: 0, pending: 0, bySector: {}, byCounty: {} };
  r.rows.forEach(x => {
    out.total += x.n; if (x.status === 'active') { out.active += x.n; out.bySector[x.sec] = (out.bySector[x.sec] || 0) + x.n; out.byCounty[x.county || 'Unknown'] = (out.byCounty[x.county || 'Unknown'] || 0) + x.n; }
    if (x.status === 'pending') out.pending += x.n;
  });
  res.json(out);
}));
// Everything the overview page needs in one call (counts only, no personal data)
app.get('/api/admin/progress', staff, wrap(async (req, res) => {
  const q = t => db(t).then(r => r.rows);
  const [status, quality, perDay, sector, byCounty, pay, channels, inv, unmatched] = await Promise.all([
    q(`SELECT status, count(*)::int n FROM members GROUP BY 1`),
    q(`SELECT count(*) FILTER (WHERE needs_review)::int review, count(*) FILTER (WHERE phone IS NULL)::int no_phone, count(*) FILTER (WHERE email IS NULL)::int no_email, count(*) FILTER (WHERE county_id IS NULL)::int no_county FROM members`),
    q(`SELECT to_char(coalesce(registered_at, created_at) AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD') d, count(*)::int n FROM members GROUP BY 1 ORDER BY 1`),
    q(`SELECT coalesce(m.sector_code,'-') AS name, count(*)::int total, count(*) FILTER (WHERE m.status='active')::int active FROM members m GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT coalesce(c.name,'Unknown') AS name, count(*)::int total, count(*) FILTER (WHERE m.status='active')::int active FROM members m LEFT JOIN counties c ON c.id=m.county_id GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT coalesce(sum(amount) FILTER (WHERE status='completed'),0)::float total, coalesce(sum(amount) FILTER (WHERE status='completed' AND date_trunc('month',completed_at)=date_trunc('month',now())),0)::float AS month, count(*) FILTER (WHERE status='completed')::int AS n FROM payments`),
    q(`SELECT channel, count(*)::int n, sum(amount)::float total FROM payments WHERE status='completed' GROUP BY 1 ORDER BY 3 DESC`),
    q(`SELECT coalesce(sum(amount_due),0)::float due, coalesce(sum(amount_paid),0)::float paid FROM dues_invoices WHERE period = date_trunc('month', now())::date`),
    q(`SELECT count(*)::int n FROM mpesa_c2b_transactions WHERE matched_member_id IS NULL`)
  ]);
  const st = Object.fromEntries(status.map(x => [x.status, x.n]));
  res.json({ total: status.reduce((a, x) => a + x.n, 0), status: st, quality: quality[0], perDay, sector, byCounty, payments: pay[0], channels, invoices: inv[0], unmatchedPaybill: unmatched[0].n, updated: new Date().toISOString() });
}));
app.get('/api/admin/payments', moneyViewers, wrap(async (req, res) => {
  const r = await db(`SELECT p.id, to_char(coalesce(p.completed_at,p.created_at) AT TIME ZONE 'Africa/Nairobi','DD Mon YYYY HH24:MI') AS date, p.receipt_no, m.membership_no, m.first_name || ' ' || m.last_name AS name, p.channel, p.amount::float, p.status, p.provider_ref
    FROM payments p JOIN members m ON m.id = p.member_id ORDER BY p.created_at DESC LIMIT $1`, [Math.min(Number(req.query.limit) || 50, 500)]);
  res.json(r.rows);
}));
app.post('/api/admin/import', approvers, express.json({ limit: '4mb' }), wrap(async (req, res) => {
  const csv = String((req.body && req.body.csv) || '');
  if (csv.length < 20) return bad(res, 'The file is empty.');
  const ex = (await db(`SELECT id_number, phone, lower(email) AS em FROM members`)).rows;
  const out = importer.prepare(csv, { ids: new Set(ex.map(x => x.id_number)), phones: new Set(ex.map(x => x.phone).filter(Boolean)), emails: new Set(ex.map(x => x.em).filter(Boolean)) });
  if (out.error) return bad(res, out.error);
  const imported = await importer.insert(pool, out.records);
  await audit(req, 'members.imported', 'members', null, { rows: out.rows, imported, rejected: out.rejects.length });
  res.json({ rows: out.rows, imported, alreadyInDatabase: out.already, mergedDuplicates: out.merged, rejected: out.rejects.length, rejectedSample: out.rejects.slice(0, 25),
    needReview: out.records.filter(r => r.rv).length, withNotes: out.records.filter(r => r.nt).length });
}));
app.post('/api/admin/members/:id/approve', approvers, wrap(async (req, res) => {
  try {
    const no = (await db('SELECT approve_member($1,$2) AS no', [req.params.id, req.user.sub])).rows[0].no;
    await monthly();   // give the new member this month's invoice
    const m = (await db('SELECT phone FROM members WHERE id=$1', [req.params.id])).rows[0];
    if (m && m.phone) await issueResetToken(req.params.id, m.phone, `KNUMLO: welcome! Your membership no. is ${no}. Set your password:`);
    res.json({ membershipNo: no });
  } catch (e) { bad(res, e.message, 409); }
}));
app.post('/api/admin/members/:id/reject', approvers, wrap(async (req, res) => {
  const r = await db("UPDATE members SET status='rejected' WHERE id=$1 AND status='pending'", [req.params.id]);
  if (!r.rowCount) return bad(res, 'Not awaiting approval.', 409);
  await audit(req, 'member.rejected', 'members', req.params.id, { reason: String(req.body.reason || '').slice(0, 200) });
  res.json({ ok: true });
}));
app.post('/api/admin/approve-bulk', approvers, wrap(async (req, res) => {
  const n = (await db('SELECT approve_members_bulk($1) AS n', [req.user.sub])).rows[0].n;
  await monthly();
  await audit(req, 'member.bulk_approved', 'members', null, { count: n });
  res.json({ approved: n });
}));
app.get(['/api/admin/export.csv', '/api/admin/export/members.csv'], memberExporters, wrap(async (req, res) => {
  const { where, p } = memberFilter(req.query);
  const r = await db(`SELECT m.membership_no, m.first_name, m.last_name, m.id_number, m.phone, m.email, m.payroll_no, m.kmltb_licence_no AS kmlttb_reg, s.name AS sector, coalesce(e.name,'') AS employer,
    m.workstation, c.name AS county, m.status, to_char(m.registered_at AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD HH24:MI') AS registered, m.needs_review, m.import_notes
    FROM members m LEFT JOIN service_sectors s ON s.code=m.sector_code LEFT JOIN employers e ON e.id=m.employer_id LEFT JOIN counties c ON c.id=m.county_id${where}
    ORDER BY m.membership_serial NULLS LAST, m.registered_at`, p);
  await audit(req, 'register.exported', 'members', null, { rows: r.rowCount });
  sendCsv(res, 'KNUMLO-members.csv', r.fields.map(f => f.name), r.rows);
}));
app.get('/api/admin/export/payments.csv', moneyViewers, wrap(async (req, res) => {
  const r = await db(`SELECT p.receipt_no, to_char(coalesce(p.completed_at,p.created_at) AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD HH24:MI') AS date, m.membership_no, m.first_name || ' ' || m.last_name AS member,
    p.channel, p.amount, p.status, p.provider_ref, p.notes FROM payments p JOIN members m ON m.id=p.member_id ORDER BY p.created_at DESC`);
  await audit(req, 'payments.exported', 'payments', null, { rows: r.rowCount });
  sendCsv(res, 'KNUMLO-payments.csv', r.fields.map(f => f.name), r.rows);
}));
app.get('/api/admin/export/audit.csv', superOnly, wrap(async (req, res) => {
  const r = await db(`SELECT created_at, actor_type, actor_id, action, entity, entity_id, details::text AS details FROM audit_log ORDER BY id DESC LIMIT 20000`);
  sendCsv(res, 'KNUMLO-audit-log.csv', r.fields.map(f => f.name), r.rows);
}));
app.get('/api/admin/paybill/unmatched', money, wrap(async (req, res) => res.json((await db('SELECT * FROM v_unmatched_paybill')).rows)));
app.post('/api/admin/paybill/:transId/match', money, wrap(async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const t = (await c.query('SELECT * FROM mpesa_c2b_transactions WHERE trans_id=$1 AND matched_member_id IS NULL FOR UPDATE', [req.params.transId])).rows[0];
    const m = (await c.query("SELECT id FROM members WHERE regexp_replace(upper(membership_no),'[^A-Z0-9]','','g') = $1", [stripKey(req.body.membershipNo)])).rows[0];
    if (!t || !m) { await c.query('ROLLBACK'); return bad(res, 'Transaction or member not found.', 404); }
    const p = (await c.query("INSERT INTO payments (member_id, channel, status, amount, payer_phone, provider_ref, recorded_by) VALUES ($1,'mpesa_paybill','completed',$2,$3,$4,$5) RETURNING id", [m.id, t.amount, t.msisdn, t.trans_id, req.user.sub])).rows[0];
    await c.query('UPDATE mpesa_c2b_transactions SET matched_member_id=$1, payment_id=$2 WHERE trans_id=$3', [m.id, p.id, t.trans_id]);
    await c.query('COMMIT'); await audit(req, 'paybill.matched', 'payments', p.id);
    res.json({ paymentId: p.id });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));
app.post('/api/admin/payments', money, wrap(async (req, res) => {
  const b = req.body || {}, amount = Number(b.amount);
  if (!['cash', 'bank_transfer', 'pesalink', 'card', 'airtel_money', 't_kash'].includes(b.channel) || !(amount > 0)) return bad(res, 'Check the channel and amount.');
  const m = (await db("SELECT id FROM members WHERE regexp_replace(upper(membership_no),'[^A-Z0-9]','','g') = $1 AND status='active'", [stripKey(b.membershipNo)])).rows[0];
  if (!m) return bad(res, 'Active member not found.', 404);
  try {
    const p = (await db("INSERT INTO payments (member_id, channel, status, amount, provider_ref, recorded_by, notes) VALUES ($1,$2,'completed',$3,$4,$5,$6) RETURNING id, receipt_no", [m.id, b.channel, amount, b.reference || null, req.user.sub, b.notes || null])).rows[0];
    await audit(req, 'payment.recorded', 'payments', p.id, { channel: b.channel, amount });
    res.status(201).json(p);
  } catch (e) { if (e.code === '23505') return bad(res, 'That reference was already recorded.', 409); throw e; }
}));

// ---------- errors and scheduler ----------
app.use('/api', (req, res) => bad(res, 'Not found', 404));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); });

const monthly = () => db('SELECT generate_monthly_invoices()').catch(e => console.error('invoice job failed', e.message));
module.exports = app;
if (require.main === module) {
  app.listen(E.PORT || 3000, () => console.log(`KNUMLO API on :${E.PORT || 3000} (M-Pesa ${daraja.MOCK ? 'MOCK' : E.DARAJA_ENV})`));
  monthly(); setInterval(monthly, 6 * 3600 * 1000);   // idempotent: creates the current month's invoices once
}
