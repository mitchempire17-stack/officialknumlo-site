-- Automatic SMS notifications: templates, outbox, payment confirmations and dues reminders. Safe to run more than once.
CREATE TABLE IF NOT EXISTS sms_templates (
  event       text PRIMARY KEY,
  title       text NOT NULL,
  body        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sms_templates (event, title, body) VALUES
 ('received',    'Registration received (sent to the applicant)', 'KNUMLO: Hello {name}, we have received your registration (Ref {ref}). It is being verified. You will get your membership number by SMS once approved.'),
 ('approved',    'Membership approved (with membership number)',  'KNUMLO: Congratulations {name}! Your membership is approved. Number: {number}. Set your password on the official KNUMLO website under Member > First time here.'),
 ('rejected',    'Application not approved',                       'KNUMLO: Hello {name}, we could not verify your application. Please contact the KNUMLO secretariat for help.'),
 ('password_set','Password set or changed (security alert)',       'KNUMLO: Your portal password was just set or changed. If this was not you, contact the KNUMLO secretariat immediately.'),
 ('payment',     'Payment confirmation',                           'KNUMLO: Payment of KES {amount} received, receipt {receipt}. Outstanding dues: KES {balance}. Thank you {name}.'),
 ('bill',        'Monthly dues notice (1st of the month)',         'KNUMLO: Dues for {month} (KES {due}) are now due. Pay via Lipa na M-Pesa Paybill {paybill}, account {number}. Outstanding: KES {balance}.'),
 ('reminder',    'Dues reminder (10th and 20th)',                  'KNUMLO: Reminder {name}, you have KES {balance} outstanding dues. Pay via Paybill {paybill}, account {number}. Ignore if already paid.')
ON CONFLICT (event) DO NOTHING;

CREATE TABLE IF NOT EXISTS sms_outbox (
  id                  bigserial PRIMARY KEY,
  member_id           uuid REFERENCES members(id),
  phone               text NOT NULL,
  event               text NOT NULL,
  message             text NOT NULL,
  dedupe_key          text UNIQUE,                 -- stops the same notice being sent twice
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts            int NOT NULL DEFAULT 0,
  provider_message_id text,
  cost                text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_outbox_queue_idx ON sms_outbox (status, id);

-- Fills {placeholders} in a template. Returns NULL if the template is switched off.
CREATE OR REPLACE FUNCTION sms_render(p_event text, p_vars jsonb) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b text; k text;
BEGIN
  SELECT body INTO b FROM sms_templates WHERE event = p_event AND enabled;
  IF b IS NULL THEN RETURN NULL; END IF;
  FOR k IN SELECT jsonb_object_keys(p_vars) LOOP b := replace(b, '{' || k || '}', coalesce(p_vars ->> k, '')); END LOOP;
  RETURN b;
END $$;

-- Queues one message for a member. Skips members with no phone or who opted out. Returns true if queued.
CREATE OR REPLACE FUNCTION sms_enqueue(p_member uuid, p_event text, p_vars jsonb, p_key text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_phone text; v_msg text; n int;
BEGIN
  SELECT phone INTO v_phone FROM members WHERE id = p_member AND phone ~ '^\+254[17][0-9]{8}$' AND NOT sms_opt_out;
  IF v_phone IS NULL THEN RETURN false; END IF;
  v_msg := sms_render(p_event, p_vars);
  IF v_msg IS NULL THEN RETURN false; END IF;
  INSERT INTO sms_outbox (member_id, phone, event, message, dedupe_key) VALUES (p_member, v_phone, p_event, v_msg, p_key)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;

-- Payment confirmation for EVERY payment route (M-Pesa prompt, Paybill, cash, bank) the moment it is completed.
CREATE OR REPLACE FUNCTION payments_sms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_name text; v_bal numeric;
BEGIN
  SELECT first_name INTO v_name FROM members WHERE id = NEW.member_id;
  SELECT coalesce(outstanding, 0) INTO v_bal FROM v_member_balance WHERE member_id = NEW.member_id;
  PERFORM sms_enqueue(NEW.member_id, 'payment', jsonb_build_object('name', v_name, 'amount', to_char(NEW.amount, 'FM999,999,990'),
          'receipt', coalesce(NEW.receipt_no, ''), 'balance', to_char(coalesce(v_bal, 0), 'FM999,999,990')), 'payment:' || NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_payments_sms_ins ON payments;
DROP TRIGGER IF EXISTS zz_payments_sms_upd ON payments;
-- named so they fire after the trigger that allocates the payment to invoices
CREATE TRIGGER zz_payments_sms_ins AFTER INSERT ON payments FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION payments_sms();
CREATE TRIGGER zz_payments_sms_upd AFTER UPDATE OF status ON payments FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') EXECUTE FUNCTION payments_sms();

-- Run once a day. Day 1 = dues notice, the given days = reminders, for members with dues outstanding.
-- Does nothing (returns 0) if no Paybill number is supplied, so wrong or missing payment details are never sent.
CREATE OR REPLACE FUNCTION queue_dues_reminders(p_paybill text, p_days int[] DEFAULT ARRAY[10,20]) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE d date := (now() AT TIME ZONE 'Africa/Nairobi')::date; ev text; n int := 0; r record;
BEGIN
  IF coalesce(p_paybill, '') = '' THEN RETURN 0; END IF;
  IF extract(day FROM d)::int = 1 THEN ev := 'bill';
  ELSIF extract(day FROM d)::int = ANY (p_days) THEN ev := 'reminder';
  ELSE RETURN 0; END IF;
  FOR r IN SELECT b.member_id, m.first_name, m.membership_no, b.outstanding,
                  coalesce((SELECT amount_due FROM dues_invoices i WHERE i.member_id = m.id AND i.period = date_trunc('month', d)::date), b.outstanding) AS due
             FROM v_member_balance b JOIN members m ON m.id = b.member_id
            WHERE m.status = 'active' AND b.outstanding > 0 LOOP
    IF sms_enqueue(r.member_id, ev, jsonb_build_object('name', r.first_name, 'number', r.membership_no, 'paybill', p_paybill,
         'balance', to_char(r.outstanding, 'FM999,999,990'), 'due', to_char(r.due, 'FM999,999,990'), 'month', trim(to_char(d, 'FMMonth YYYY'))),
         ev || ':' || d || ':' || r.member_id) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;


-- Automatic lifecycle notices. All are transactional and idempotent.
-- Queuing from table triggers covers web registration, CSV imports, single and bulk approvals.
CREATE OR REPLACE FUNCTION knumlo_member_sms_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ref text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      v_ref := 'APP-' || upper(substr(NEW.id::text, 1, 6));
      PERFORM sms_enqueue(NEW.id,'received',jsonb_build_object('name',NEW.first_name,'ref',v_ref), 'registration:' || NEW.id);
    ELSIF NEW.status = 'active' AND NEW.membership_no IS NOT NULL THEN
      PERFORM sms_enqueue(NEW.id,'approved',jsonb_build_object('name',NEW.first_name,'number',NEW.membership_no,'site',coalesce((SELECT value FROM knumlo_sms_settings WHERE key='public_site_url'),'')), 'approved:' || NEW.id);
    END IF;
  ELSE
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'active' AND NEW.membership_no IS NOT NULL THEN
        PERFORM sms_enqueue(NEW.id,'approved',jsonb_build_object('name',NEW.first_name,'number',NEW.membership_no,'site',coalesce((SELECT value FROM knumlo_sms_settings WHERE key='public_site_url'),'')), 'approved:' || NEW.id);
      ELSIF NEW.status::text = 'rejected' THEN
        PERFORM sms_enqueue(NEW.id,'rejected',jsonb_build_object('name',NEW.first_name), 'rejected:' || NEW.id);
      END IF;
    END IF;
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash AND NEW.password_hash IS NOT NULL THEN
      PERFORM sms_enqueue(NEW.id,'password_set','{}'::jsonb, 'password:' || NEW.id || ':' || md5(NEW.password_hash));
    END IF;
  END IF;
  RETURN NULL;
END $$;
-- Public URL is injected by the daily function or set by migration. Do not hardcode an unknown site address.
CREATE TABLE IF NOT EXISTS knumlo_sms_settings (key text PRIMARY KEY, value text NOT NULL);
DROP TRIGGER IF EXISTS zz_knumlo_member_sms_insert ON members;
DROP TRIGGER IF EXISTS zz_knumlo_member_sms_update ON members;
CREATE TRIGGER zz_knumlo_member_sms_insert AFTER INSERT ON members
FOR EACH ROW EXECUTE FUNCTION knumlo_member_sms_event();
CREATE TRIGGER zz_knumlo_member_sms_update AFTER UPDATE OF status, password_hash ON members
FOR EACH ROW EXECUTE FUNCTION knumlo_member_sms_event();

-- Keep any outstanding reminders out of re-runs unless officials explicitly initiate a historical broadcast.
-- No retroactive population of sms_outbox is performed by this migration.
