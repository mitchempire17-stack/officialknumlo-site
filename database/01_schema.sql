-- KNUMLO backend database (PostgreSQL 14+)
-- Members, dues, M-Pesa Paybill and other payments, newsletter, leadership, staff.
-- Run: psql -d knumlo -f 01_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Types ----------
CREATE TYPE member_status   AS ENUM ('pending','active','suspended','exited');
CREATE TYPE payment_channel AS ENUM ('mpesa_paybill','mpesa_stk','airtel_money','t_kash','card','bank_transfer','pesalink','cash');
CREATE TYPE payment_status  AS ENUM ('pending','completed','failed','cancelled','reversed');
CREATE TYPE invoice_status  AS ENUM ('unpaid','partial','paid','waived');
CREATE TYPE staff_role      AS ENUM ('super_admin','treasurer','secretary','branch_officer','viewer');
CREATE TYPE facility_type   AS ENUM ('public','private','faith_based','ngo','academic','other');

-- ---------- Helpers ----------
CREATE SEQUENCE membership_seq START 1;
CREATE SEQUENCE receipt_seq    START 1;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------- Reference data ----------
CREATE TABLE counties (
  id   smallint PRIMARY KEY,            -- official county code 1-47
  name text NOT NULL UNIQUE
);

CREATE TABLE branches (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  county_id smallint NOT NULL REFERENCES counties(id)
);

CREATE TABLE cadres (
  id   smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL UNIQUE
);

CREATE TABLE facilities (
  id        serial PRIMARY KEY,
  name      text NOT NULL,
  type      facility_type NOT NULL DEFAULT 'public',
  county_id smallint REFERENCES counties(id),
  UNIQUE (name, county_id)
);

-- ---------- Staff (secretariat / admin users) ----------
CREATE TABLE staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,                 -- argon2id or bcrypt, never plain text
  role          staff_role NOT NULL DEFAULT 'viewer',
  branch_id     int REFERENCES branches(id),   -- for branch officers
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_email_uq ON staff_users (lower(email));
CREATE TRIGGER staff_updated BEFORE UPDATE ON staff_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Members ----------
CREATE TABLE members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_no      text NOT NULL UNIQUE
                     DEFAULT 'KNUMLO-' || lpad(nextval('membership_seq')::text, 4, '0'),
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  id_number          text UNIQUE,              -- national ID: encrypt at rest / restrict access
  phone              text NOT NULL UNIQUE CHECK (phone ~ '^\+254[17][0-9]{8}$'),
  email              text,
  kmltb_licence_no   text,                     -- professional board registration
  cadre_id           smallint REFERENCES cadres(id),
  facility_id        int REFERENCES facilities(id),
  county_id          smallint REFERENCES counties(id),
  branch_id          int REFERENCES branches(id),
  status             member_status NOT NULL DEFAULT 'pending',
  date_joined        date NOT NULL DEFAULT current_date,
  password_hash      text,                     -- argon2id or bcrypt
  must_change_password boolean NOT NULL DEFAULT true,
  failed_logins      smallint NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX members_email_uq ON members (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX members_status_idx ON members (status);
CREATE INDEX members_branch_idx ON members (branch_id);
CREATE TRIGGER members_updated BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE password_resets (
  id         bigserial PRIMARY KEY,
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash text NOT NULL,                    -- store a hash of the emailed/SMS token
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Dues ----------
CREATE TABLE dues_plans (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  amount_kes     numeric(12,2) NOT NULL CHECK (amount_kes > 0),
  cadre_id       smallint REFERENCES cadres(id),      -- NULL = applies to all cadres
  effective_from date NOT NULL,
  effective_to   date,
  active         boolean NOT NULL DEFAULT true
);

CREATE TABLE dues_invoices (            -- one row per member per month
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES members(id),
  period      date NOT NULL CHECK (period = date_trunc('month', period)::date),
  amount_due  numeric(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status      invoice_status NOT NULL DEFAULT 'unpaid',
  due_date    date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, period)
);
CREATE INDEX invoices_open_idx ON dues_invoices (member_id, period) WHERE status IN ('unpaid','partial');
CREATE TRIGGER invoices_updated BEFORE UPDATE ON dues_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Payments ----------
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members(id),
  reference    text NOT NULL UNIQUE DEFAULT 'PAY' || upper(substr(md5(random()::text), 1, 10)),
  channel      payment_channel NOT NULL,
  status       payment_status NOT NULL DEFAULT 'pending',
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  months_covered smallint,
  payer_phone  text,
  provider_ref text,                           -- M-Pesa receipt, bank/PesaLink ref, card auth id
  receipt_no   text UNIQUE,                    -- issued when completed
  unallocated  numeric(12,2) NOT NULL DEFAULT 0,   -- advance credit beyond open invoices
  recorded_by  uuid REFERENCES staff_users(id),    -- set for manual/cash/bank entries
  notes        text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- A provider receipt can only ever be recorded once (makes callbacks idempotent)
CREATE UNIQUE INDEX payments_provider_ref_uq ON payments (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payments_member_idx ON payments (member_id, created_at DESC);
CREATE INDEX payments_status_idx ON payments (status);
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_allocations (
  id         bigserial PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  invoice_id uuid NOT NULL REFERENCES dues_invoices(id),
  amount     numeric(12,2) NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, invoice_id)
);

-- M-Pesa STK push requests (Daraja: Lipa na M-Pesa Online)
CREATE TABLE mpesa_stk_requests (
  id                   bigserial PRIMARY KEY,
  payment_id           uuid NOT NULL REFERENCES payments(id),
  merchant_request_id  text,
  checkout_request_id  text UNIQUE,
  phone                text NOT NULL,
  amount               numeric(12,2) NOT NULL,
  account_reference    text NOT NULL,            -- the membership number
  result_code          int,
  result_desc          text,
  callback_payload     jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER stk_updated BEFORE UPDATE ON mpesa_stk_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- M-Pesa Paybill confirmations (Daraja: C2B). Account number = membership number.
CREATE TABLE mpesa_c2b_transactions (
  id                bigserial PRIMARY KEY,
  trans_id          text NOT NULL UNIQUE,        -- M-Pesa receipt number
  trans_time        timestamptz,
  amount            numeric(12,2) NOT NULL,
  bill_ref_number   text,                        -- what the member typed as account number
  msisdn            text,
  payer_name        text,
  matched_member_id uuid REFERENCES members(id), -- NULL = unmatched, treasurer resolves
  payment_id        uuid REFERENCES payments(id),
  raw_payload       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX c2b_unmatched_idx ON mpesa_c2b_transactions (created_at) WHERE matched_member_id IS NULL;

-- ---------- Website content ----------
CREATE TABLE newsletter_subscribers (
  id               bigserial PRIMARY KEY,
  email            text NOT NULL,
  full_name        text,
  confirm_token    text,
  source           text DEFAULT 'website',
  subscribed_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz
);
CREATE UNIQUE INDEX newsletter_email_uq ON newsletter_subscribers (lower(email));

CREATE TABLE leaders (
  id            serial PRIMARY KEY,
  member_id     uuid REFERENCES members(id),
  full_name     text NOT NULL,
  position      text NOT NULL,
  bio           text,
  photo_url     text,
  display_order smallint NOT NULL DEFAULT 0,
  term_start    date,
  term_end      date,
  active        boolean NOT NULL DEFAULT true
);

-- ---------- Audit trail ----------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_type  text NOT NULL CHECK (actor_type IN ('member','staff','system')),
  actor_id    uuid,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  details     jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);

-- ---------- Payment logic ----------
-- Issue a receipt number and completion time when a payment is completed.
CREATE FUNCTION payments_before_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    IF NEW.receipt_no IS NULL THEN
      NEW.receipt_no := 'RCT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('receipt_seq')::text, 6, '0');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_complete_before BEFORE INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_before_complete();

-- Allocate a completed payment to the member's oldest unpaid months first.
CREATE FUNCTION apply_payment(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE; inv RECORD; remaining numeric; take numeric;
BEGIN
  SELECT * INTO p FROM payments WHERE id = p_id FOR UPDATE;
  IF p.status <> 'completed' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM payment_allocations WHERE payment_id = p_id) THEN RETURN; END IF;
  remaining := p.amount;
  FOR inv IN SELECT * FROM dues_invoices
             WHERE member_id = p.member_id AND status IN ('unpaid','partial')
             ORDER BY period FOR UPDATE LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(remaining, inv.amount_due - inv.amount_paid);
    INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (p_id, inv.id, take);
    UPDATE dues_invoices
       SET amount_paid = amount_paid + take,
           status = CASE WHEN amount_paid + take >= amount_due THEN 'paid'::invoice_status ELSE 'partial'::invoice_status END
     WHERE id = inv.id;
    remaining := remaining - take;
  END LOOP;
  UPDATE payments SET unallocated = remaining WHERE id = p_id;
END $$;

CREATE FUNCTION payments_after_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM apply_payment(NEW.id); RETURN NULL; END $$;
CREATE TRIGGER payments_alloc_ins AFTER INSERT ON payments
  FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION payments_after_complete();
CREATE TRIGGER payments_alloc_upd AFTER UPDATE OF status ON payments
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION payments_after_complete();

-- Create this month's invoices for all active members (run on the 1st by a scheduler).
CREATE FUNCTION generate_monthly_invoices(p_period date DEFAULT date_trunc('month', now())::date)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO dues_invoices (member_id, period, amount_due, due_date)
  SELECT m.id, p_period, pl.amount_kes, (p_period + 14)
    FROM members m
    JOIN LATERAL (
      SELECT amount_kes FROM dues_plans
       WHERE active AND effective_from <= p_period
         AND (effective_to IS NULL OR effective_to >= p_period)
         AND (cadre_id IS NULL OR cadre_id = m.cadre_id)
       ORDER BY cadre_id NULLS LAST, effective_from DESC LIMIT 1
    ) pl ON true
   WHERE m.status = 'active'
  ON CONFLICT (member_id, period) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Called by the Paybill (C2B) confirmation endpoint. Safe to call twice for the same receipt.
-- Returns the new payment id, or NULL if duplicate or no member matched the account number.
CREATE FUNCTION record_c2b_payment(
  p_trans_id text, p_trans_time timestamptz, p_amount numeric, p_bill_ref text,
  p_msisdn text, p_payer_name text, p_raw jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_member uuid; v_pay uuid;
BEGIN
  INSERT INTO mpesa_c2b_transactions (trans_id, trans_time, amount, bill_ref_number, msisdn, payer_name, raw_payload)
  VALUES (p_trans_id, p_trans_time, p_amount, p_bill_ref, p_msisdn, p_payer_name, p_raw)
  ON CONFLICT (trans_id) DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_member FROM members
   WHERE upper(replace(membership_no, ' ', '')) = upper(replace(coalesce(p_bill_ref, ''), ' ', ''));
  IF v_member IS NULL THEN RETURN NULL; END IF;

  INSERT INTO payments (member_id, channel, status, amount, payer_phone, provider_ref)
  VALUES (v_member, 'mpesa_paybill', 'completed', p_amount, p_msisdn, p_trans_id)
  RETURNING id INTO v_pay;

  UPDATE mpesa_c2b_transactions SET matched_member_id = v_member, payment_id = v_pay WHERE trans_id = p_trans_id;
  RETURN v_pay;
END $$;

-- ---------- Views for the portal and reports ----------
CREATE VIEW v_member_balance AS
SELECT m.id AS member_id, m.membership_no,
       m.first_name || ' ' || m.last_name AS full_name,
       COALESCE(SUM(i.amount_due - i.amount_paid) FILTER (WHERE i.status IN ('unpaid','partial')), 0) AS outstanding,
       COALESCE(SUM(i.amount_paid), 0) AS total_paid,
       COUNT(i.id) FILTER (WHERE i.status IN ('unpaid','partial')) AS months_owed,
       CASE WHEN COUNT(i.id) FILTER (WHERE i.status IN ('unpaid','partial')) = 0
            THEN 'up_to_date' ELSE 'pending' END AS dues_status
  FROM members m
  LEFT JOIN dues_invoices i ON i.member_id = m.id
 GROUP BY m.id;

CREATE VIEW v_monthly_collections AS
SELECT date_trunc('month', completed_at)::date AS month, channel,
       COUNT(*) AS payments, SUM(amount) AS total_kes
  FROM payments WHERE status = 'completed'
 GROUP BY 1, 2;

CREATE VIEW v_unmatched_paybill AS
SELECT trans_id, trans_time, amount, bill_ref_number, msisdn, payer_name
  FROM mpesa_c2b_transactions WHERE matched_member_id IS NULL ORDER BY created_at;
