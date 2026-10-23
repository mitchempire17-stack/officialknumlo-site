// Safaricom Daraja client (STK push and C2B URL registration). Mock mode when no consumer key is set.
const E = process.env;
const BASE = E.DARAJA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
const MOCK = !E.DARAJA_CONSUMER_KEY;
let tok = { v: null, exp: 0 };

async function token() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  const r = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${E.DARAJA_CONSUMER_KEY}:${E.DARAJA_CONSUMER_SECRET}`).toString('base64') }
  });
  if (!r.ok) throw new Error('Daraja auth failed: ' + r.status);
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in || 3500) - 60) * 1000 };
  return tok.v;
}
const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);

async function stkPush({ amount, phone, ref, desc }) {
  if (MOCK) return { MerchantRequestID: 'MOCK-' + Date.now(), CheckoutRequestID: 'ws_CO_MOCK' + Math.random().toString(36).slice(2, 12), ResponseCode: '0' };
  const ts = stamp();
  const body = {
    BusinessShortCode: E.DARAJA_SHORTCODE,
    Password: Buffer.from(E.DARAJA_SHORTCODE + E.DARAJA_PASSKEY + ts).toString('base64'),
    Timestamp: ts, TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount), PartyA: phone, PartyB: E.DARAJA_SHORTCODE, PhoneNumber: phone,
    CallBackURL: `${E.PUBLIC_API_URL}/api/mpesa/${E.MPESA_CALLBACK_SECRET}/stk`,
    AccountReference: ref.slice(0, 12), TransactionDesc: (desc || 'KNUMLO dues').slice(0, 13)
  };
  const r = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok || j.ResponseCode !== '0') throw new Error(j.errorMessage || j.ResponseDescription || 'STK push failed');
  return j;
}

async function registerC2B() {
  if (MOCK) return { mock: true };
  const r = await fetch(`${BASE}/mpesa/c2b/v1/registerurl`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ShortCode: E.DARAJA_SHORTCODE, ResponseType: 'Completed',
      ConfirmationURL: `${E.PUBLIC_API_URL}/api/mpesa/${E.MPESA_CALLBACK_SECRET}/c2b/confirmation`,
      ValidationURL: `${E.PUBLIC_API_URL}/api/mpesa/${E.MPESA_CALLBACK_SECRET}/c2b/validation`
    })
  });
  return r.json();
}
module.exports = { stkPush, registerC2B, MOCK };
