// Cleans the Google Form registrations export and prepares it for the database. Mirrors database/import_registrations.py.
const CO = "Mombasa,Kwale,Kilifi,Tana River,Lamu,Taita-Taveta,Garissa,Wajir,Mandera,Marsabit,Isiolo,Meru,Tharaka-Nithi,Embu,Kitui,Machakos,Makueni,Nyandarua,Nyeri,Kirinyaga,Murang'a,Kiambu,Turkana,West Pokot,Samburu,Trans Nzoia,Uasin Gishu,Elgeyo-Marakwet,Nandi,Baringo,Laikipia,Nakuru,Narok,Kajiado,Kericho,Bomet,Kakamega,Vihiga,Bungoma,Busia,Siaya,Kisumu,Homa Bay,Migori,Kisii,Nyamira,Nairobi".split(',');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const KEYS = [...CO.map((c, i) => [norm(c), i + 1]), ['muranga', 21], ['homabay', 43], ['taitataveta', 6], ['tharakanithi', 13], ['elgeyomarakwet', 28], ['elgeiyomarakwet', 28], ['elgeyo', 28], ['uasingishu', 27], ['transnzoia', 26], ['transzoia', 26]].sort((a, b) => b[0].length - a[0].length);
const ALIAS = [['makadara', 47], ['kamukunji', 47], ['embakasi', 47], ['nairobicity', 47], ['kinango', 2], ['wundanyi', 6], ['chuka', 13], ['kapsabet', 29], ['iten', 28], ['marakwet', 28], ['kapenguria', 24], ['wote', 17], ['nanyuki', 31], ['nyahururu', 31], ['borabu', 46], ['kuria', 44], ['emc', 28], ['tnc', 13]];
function county(...texts) {
  for (const t of texts) {
    const n = norm(t);
    if (!n || ['option', 'none', 'national', 'nad'].includes(n)) continue;
    for (const [k, i] of KEYS) if (n.includes(k)) return i;
    for (const [k, i] of ALIAS) if (n.includes(k)) return i;
  }
  return null;
}
const HOSP = [[/\bmtrh\b|moi teaching/, 'MTRH'], [/\bknh\b|kenyatta national/, 'KNH'], [/kutrrh/, 'KUTRRH'], [/joorth|jootrh|jaramogi oginga odinga teaching/, 'JOORTH'], [/mntrh|mathari national/, 'MNTRH']];
function sector(ws, payroll) {
  const t = String(ws || '').toLowerCase();
  for (const [rx, c] of HOSP) if (rx.test(t)) return ['PAR', c];
  if (/\bmission\b|\bagc\b|tenwek|st\.? ?mary/.test(t)) return ['MISS', null];
  if (/private/.test(String(payroll || '').toLowerCase()) || /private/.test(t)) return ['PRI', null];
  return ['CPS', null];
}
const phone = p => {
  let s = String(p || '').split(/[\/,;]/)[0].toUpperCase().replace(/O(?=\d)/g, '0').replace(/[^\d+]/g, '');
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(s);
  return m ? '+254' + m[1] : null;
};
const email = e => { e = String(e || '').trim().toLowerCase(); return /^[^@\s.][^@\s]*@[^@\s]+\.[a-z]{2,}$/.test(e) && !e.includes('..') ? e : null; };
const titled = s => { s = String(s || '').trim().replace(/\s+/g, ' '); return (s === s.toUpperCase() || s === s.toLowerCase()) ? s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s; };
const blank = v => ['', 'option 1', 'none', 'n/a', 'na', 'nil', 'null', '0'].includes(String(v || '').trim().toLowerCase());

function parse(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const d = ((text.split(/\r?\n/)[0].match(/\t/g)) || []).length > 2 ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && cur === '') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

// existing = { ids:Set, phones:Set, emails:Set } already in the database
function prepare(text, existing = {}) {
  const all = parse(text);
  if (all.length < 2) return { error: 'The file has no rows.' };
  const h = all[0].map(norm), col = (...names) => h.findIndex(x => names.some(n => x.includes(n)));
  const ix = { ts: col('timestamp'), name: col('fullname'), em: col('emailaddress', 'email'), ph: col('phonenumber', 'phone'), id: col('idnumber'), pay: col('payroll'), reg: col('kmlttb', 'kmltb'), br: col('branch'), ws: col('workstation') };
  if (ix.name < 0 || ix.id < 0) return { error: 'Columns not found. The first row must have "Full Name" and "ID Number".' };
  const g = (r, k) => (ix[k] >= 0 ? String(r[ix[k]] || '').trim() : '');
  const groups = new Map(), rejects = [];
  for (const r of all.slice(1)) {
    const id = g(r, 'id').replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(id)) { rejects.push({ id: g(r, 'id'), name: g(r, 'name'), reason: 'ID number is not 6-8 digits' }); continue; }
    const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)$/.exec(g(r, 'ts'));
    const t = m ? Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4] - 3, +m[5], +m[6]) : Date.UTC(2026, 9, 16);
    const rec = { id, t, name: g(r, 'name'), em: g(r, 'em'), ph: g(r, 'ph'), pay: g(r, 'pay'), reg: g(r, 'reg'), br: g(r, 'br'), ws: g(r, 'ws') };
    if (!groups.has(id)) groups.set(id, []); groups.get(id).push(rec);
  }
  const usedPh = new Set(existing.phones || []), usedEm = new Set(existing.emails || []), ids = existing.ids || new Set();
  const records = []; let already = 0, merged = 0;
  const ordered = [...groups.entries()].sort((a, b) => Math.min(...a[1].map(x => x.t)) - Math.min(...b[1].map(x => x.t)));
  for (const [id, g0] of ordered) {
    if (ids.has(id)) { already++; continue; }
    g0.sort((a, b) => a.t - b.t); const last = g0[g0.length - 1], notes = [];
    const pick = (f, ok = v => !blank(v)) => { for (let i = g0.length - 1; i >= 0; i--) if (ok(g0[i][f])) return g0[i][f]; return ''; };
    const br = pick('br'), ws = pick('ws');
    let ph = null, em = null;
    for (let i = g0.length - 1; i >= 0 && !ph; i--) ph = phone(g0[i].ph);
    for (let i = g0.length - 1; i >= 0 && !em; i--) em = email(g0[i].em);
    if (!ph) notes.push('phone missing or invalid'); else if (usedPh.has(ph)) { ph = null; notes.push('phone already used by another member'); }
    if (!em) notes.push('email missing or invalid'); else if (usedEm.has(em)) { em = null; notes.push('email already used by another member'); }
    if (ph) usedPh.add(ph); if (em) usedEm.add(em);
    if (g0.length > 1) { notes.push(`${g0.length} form submissions merged`); merged++; }
    const [sec, emp] = sector(ws, last.pay), co = county(br, ws);
    if (sec === 'CPS') notes.push('sector assumed CPS; verify');
    const rv = co === null && sec !== 'PAR';
    if (rv) notes.push('county not identified');
    const nm = titled(last.name).split(' '), first = nm.shift() || '-';
    const reg = pick('reg').toUpperCase().replace(/\s/g, '').replace(/^A[O0]/, 'A0') || null;
    const pay = !blank(last.pay) && /^[\w\/\-]+$/.test(last.pay) && !/private/i.test(last.pay) ? last.pay : null;
    records.push({ fn: first, ln: nm.join(' ') || '-', idn: id, ph, em, reg, pay, sec, emp, co, ws: titled(ws) || null, ts: new Date(g0[0].t).toISOString(), rv, nt: notes.join('; ') || null });
  }
  return { records, rejects, already, merged, rows: all.length - 1 };
}

async function insert(pool, recs) {
  if (!recs.length) return 0;
  const col = f => recs.map(r => r[f]);
  const r = await pool.query(`INSERT INTO members (first_name,last_name,id_number,phone,email,kmltb_licence_no,payroll_no,sector_code,employer_id,county_id,branch_id,workstation,status,registered_at,needs_review,import_notes)
    SELECT t.fn,t.ln,t.idn,t.ph,t.em,t.reg,t.pay,t.sec,e.id,t.co,b.id,t.ws,'pending',t.ts,t.rv,t.nt
    FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::int[],$11::text[],$12::timestamptz[],$13::boolean[],$14::text[])
         AS t(fn,ln,idn,ph,em,reg,pay,sec,emp,co,ws,ts,rv,nt)
    LEFT JOIN employers e ON e.code = t.emp
    LEFT JOIN LATERAL (SELECT id FROM branches WHERE county_id = t.co LIMIT 1) b ON true
    ON CONFLICT DO NOTHING`,
    [col('fn'), col('ln'), col('idn'), col('ph'), col('em'), col('reg'), col('pay'), col('sec'), col('emp'), col('co'), col('ws'), col('ts'), col('rv'), col('nt')]);
  return r.rowCount;
}
module.exports = { prepare, insert, parse, phone, email, county, sector };
