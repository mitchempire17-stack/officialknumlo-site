// Bulk and single SMS through Africa's Talking. Everything is configured by environment variables in Netlify.
const E = process.env;
const digits = s => String(s || '').replace(/\D/g, '');
const base = () => E.AT_BASE_URL || (E.AT_ENV === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com');
const live = () => E.SMS_PROVIDER === 'africastalking' && !!E.AT_API_KEY && !!E.AT_USERNAME;
const senderIds = () => [...new Set([E.AT_SENDER_ID, ...String(E.SMS_SENDER_IDS || '').split(',')].map(s => String(s || '').trim()).filter(Boolean))];

// Sends one message to many numbers. Returns one result per number: { phone, ok, id, cost, error }.
async function sendMany(phones, message, { senderId = null, bulk = true } = {}) {
  if (!live()) {
    console.log(`[SMS simulated to ${phones.length} number(s)${senderId ? ' from ' + senderId : ''}] ${message}`);
    return phones.map(phone => ({ phone, ok: true, id: 'simulated', cost: '0' }));
  }
  const body = new URLSearchParams({ username: E.AT_USERNAME, to: phones.join(','), message });
  if (bulk) body.set('bulkSMSMode', '1');
  if (senderId && E.AT_ENV !== 'sandbox') body.set('from', senderId);
  const r = await fetch(base() + '/version1/messaging', { method: 'POST', headers: { apiKey: E.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.SMSMessageData) throw new Error(`The SMS provider rejected the request (${r.status}). Check the API key, username and sender ID.`);
  const rec = j.SMSMessageData.Recipients || [];
  return phones.map(phone => {
    const x = rec.find(y => digits(y.number) === digits(phone));
    if (!x) return { phone, ok: false, error: j.SMSMessageData.Message || 'No response for this number' };
    const ok = [100, 101, 102].includes(Number(x.statusCode));
    return { phone, ok, id: x.messageId || null, cost: x.cost || null, error: ok ? null : (x.status || 'Failed') };
  });
}
// One transactional message (password links and similar).
async function sendSms(phone, text) {
  const [r] = await sendMany([phone], text, { senderId: senderIds()[0] || null, bulk: false });
  if (!r.ok) console.error('SMS failed:', r.error);
  return r;
}
// Remaining credit, or null if unavailable.
async function balance() {
  if (!live()) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${base()}/version1/user?username=${encodeURIComponent(E.AT_USERNAME)}`, { headers: { apiKey: E.AT_API_KEY, Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json(); return (j.UserData && j.UserData.balance) || null;
  } catch { return null; }
}
// Characters and SMS parts (GSM-7 = 160 / 153 per part, otherwise Unicode = 70 / 67)
function segments(m) {
  const n = [...String(m)].length, uni = /[^\x20-\x7E\n\r£¥èéùìòÇØøÅåÆæßÉ¤¡ÄÖÑÜ§¿äöñüà]/.test(m);
  return { chars: n, parts: n === 0 ? 0 : uni ? (n <= 70 ? 1 : Math.ceil(n / 67)) : (n <= 160 ? 1 : Math.ceil(n / 153)) };
}
module.exports = { sendMany, sendSms, balance, segments, senderIds, live };
