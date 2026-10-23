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
-- Reference data. Run after 01_schema.sql.
INSERT INTO counties (id, name) VALUES
(1,'Mombasa'),(2,'Kwale'),(3,'Kilifi'),(4,'Tana River'),(5,'Lamu'),(6,'Taita-Taveta'),(7,'Garissa'),(8,'Wajir'),
(9,'Mandera'),(10,'Marsabit'),(11,'Isiolo'),(12,'Meru'),(13,'Tharaka-Nithi'),(14,'Embu'),(15,'Kitui'),(16,'Machakos'),
(17,'Makueni'),(18,'Nyandarua'),(19,'Nyeri'),(20,'Kirinyaga'),(21,'Murang''a'),(22,'Kiambu'),(23,'Turkana'),(24,'West Pokot'),
(25,'Samburu'),(26,'Trans Nzoia'),(27,'Uasin Gishu'),(28,'Elgeyo-Marakwet'),(29,'Nandi'),(30,'Baringo'),(31,'Laikipia'),
(32,'Nakuru'),(33,'Narok'),(34,'Kajiado'),(35,'Kericho'),(36,'Bomet'),(37,'Kakamega'),(38,'Vihiga'),(39,'Bungoma'),
(40,'Busia'),(41,'Siaya'),(42,'Kisumu'),(43,'Homa Bay'),(44,'Migori'),(45,'Kisii'),(46,'Nyamira'),(47,'Nairobi');

INSERT INTO branches (name, county_id) SELECT name || ' Branch', id FROM counties;

INSERT INTO cadres (name) VALUES
('Medical Laboratory Officer'),('Medical Laboratory Technologist'),('Medical Laboratory Technician'),('Intern');

-- Placeholder monthly dues of KES 300 for all cadres. Change to the real amount.
INSERT INTO dues_plans (name, amount_kes, effective_from) VALUES ('Standard monthly dues', 500, '2026-01-01');

INSERT INTO leaders (full_name, position, display_order) VALUES
('Full Name','National Chairperson',1),('Full Name','Secretary General',2),
('Full Name','National Treasurer',3),('Full Name','Organising Secretary',4);
-- KNUMLO membership numbers: KNUMLO/<SERVICE CODE>/<SERIAL>/<EMPLOYER OR COUNTY CODE>
-- Run after 01_schema.sql and 02_seed.sql. Serial is database-enforced, atomic and never reused.

ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'rejected';

CREATE TABLE service_sectors (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  employer_rule text NOT NULL CHECK (employer_rule IN ('NATIONAL','EMPLOYER','COUNTY'))
);   -- NATIONAL => NG, EMPLOYER => the employer's own code, COUNTY => 3-digit county code
INSERT INTO service_sectors VALUES
 ('MOH','Ministry of Health','NATIONAL'),('CPS','County Public Service','COUNTY'),
 ('PAR','National referral hospitals','EMPLOYER'),('PRI','Private hospitals','COUNTY'),
 ('MISS','Mission hospitals','COUNTY'),('UN','Universities and training institutions','COUNTY'),
 ('SC','Other state corporations and institutions','NATIONAL');

CREATE TABLE employers (   -- officials add hospitals, universities, corporations here, no redesign needed
  id          serial PRIMARY KEY,
  sector_code text NOT NULL REFERENCES service_sectors(code),
  name        text NOT NULL,
  code        text,
  county_id   smallint REFERENCES counties(id),
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (sector_code, name)
);
INSERT INTO employers (sector_code, name, code) VALUES
 ('PAR','Kenyatta National Hospital','KNH'),('PAR','Moi Teaching and Referral Hospital','MTRH'),
 ('PAR','Kenyatta University Teaching, Referral and Research Hospital','KUTRRH'),
 ('PAR','Jaramogi Oginga Odinga Teaching and Referral Hospital','JOORTH'),
 ('PAR','Mathari National Teaching and Referral Hospital','MNTRH');

ALTER TABLE members
  ALTER COLUMN membership_no DROP NOT NULL, ALTER COLUMN membership_no DROP DEFAULT,
  ALTER COLUMN id_number SET NOT NULL,
  ADD COLUMN sector_code text REFERENCES service_sectors(code),
  ADD COLUMN employer_id int REFERENCES employers(id),
  ADD COLUMN designation text,
  ADD COLUMN workstation text,
  ADD COLUMN membership_serial integer UNIQUE,
  ADD COLUMN approved_by uuid REFERENCES staff_users(id),
  ADD COLUMN approved_at timestamptz,
  ADD CONSTRAINT membership_no_format CHECK (membership_no IS NULL OR membership_no ~ '^KNUMLO/[A-Z]+/[0-9]{3,}/[A-Z0-9]+$');
-- Duplicate detection on ID/passport ignoring case and spaces (phone and email are already unique)
CREATE UNIQUE INDEX members_id_norm_uq ON members (upper(replace(id_number, ' ', '')));

CREATE SEQUENCE membership_serial_seq START 1;   -- nextval() is atomic across simultaneous registrations

-- Approval is the ONLY way a number is issued. Registration alone never creates one.
CREATE FUNCTION approve_member(p_member uuid, p_staff uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE m members%ROWTYPE; rule text; ecode text; s int; v_code text;
BEGIN
  SELECT * INTO m FROM members WHERE id = p_member FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF m.status <> 'pending' OR m.membership_no IS NOT NULL THEN RAISE EXCEPTION 'Member is not awaiting approval'; END IF;
  SELECT employer_rule INTO rule FROM service_sectors WHERE code = m.sector_code;
  IF rule = 'NATIONAL' THEN ecode := 'NG';
  ELSIF rule = 'EMPLOYER' THEN SELECT e.code INTO ecode FROM employers e WHERE e.id = m.employer_id;
  ELSE ecode := lpad(m.county_id::text, 3, '0'); END IF;
  IF ecode IS NULL THEN RAISE EXCEPTION 'Employer or county code is missing'; END IF;
  s := nextval('membership_serial_seq');
  v_code := 'KNUMLO/' || m.sector_code || '/' || lpad(s::text, 3, '0') || '/' || ecode;
  UPDATE members SET membership_serial = s, membership_no = v_code, status = 'active',
         approved_by = p_staff, approved_at = now() WHERE id = p_member;
  INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, details)
  VALUES (CASE WHEN p_staff IS NULL THEN 'system' ELSE 'staff' END, p_staff, 'member.approved', 'members', p_member::text,
          jsonb_build_object('membership_no', v_code));
  RETURN v_code;
END $$;

-- A number is permanent: transfers, new employers and county moves never change it.
CREATE FUNCTION members_protect_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.membership_no IS NOT NULL THEN RAISE EXCEPTION 'Members with a number cannot be deleted; set status to exited'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.membership_no IS NOT NULL AND (NEW.membership_no IS DISTINCT FROM OLD.membership_no
     OR NEW.membership_serial IS DISTINCT FROM OLD.membership_serial) THEN
    RAISE EXCEPTION 'Membership number is permanent and cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER members_number_lock BEFORE UPDATE OR DELETE ON members FOR EACH ROW EXECUTE FUNCTION members_protect_number();

CREATE FUNCTION members_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (actor_type, action, entity, entity_id, details)
  VALUES ('system', 'member.registered', 'members', NEW.id::text, jsonb_build_object('sector', NEW.sector_code));
  RETURN NEW;
END $$;
CREATE TRIGGER members_audit_ins AFTER INSERT ON members FOR EACH ROW EXECUTE FUNCTION members_audit_insert();

-- Paybill matching now ignores slashes, spaces and case in the account number
CREATE OR REPLACE FUNCTION record_c2b_payment(
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
   WHERE regexp_replace(upper(membership_no), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(coalesce(p_bill_ref, '')), '[^A-Z0-9]', '', 'g');
  IF v_member IS NULL THEN RETURN NULL; END IF;
  INSERT INTO payments (member_id, channel, status, amount, payer_phone, provider_ref)
  VALUES (v_member, 'mpesa_paybill', 'completed', p_amount, p_msisdn, p_trans_id) RETURNING id INTO v_pay;
  UPDATE mpesa_c2b_transactions SET matched_member_id = v_member, payment_id = v_pay WHERE trans_id = p_trans_id;
  RETURN v_pay;
END $$;

-- Public QR verification: returns only validity and sector, never personal data
CREATE FUNCTION verify_membership(p_no text) RETURNS TABLE (valid boolean, sector text)
LANGUAGE sql STABLE AS $$
  SELECT (m.status = 'active'), s.name FROM members m JOIN service_sectors s ON s.code = m.sector_code
   WHERE upper(m.membership_no) = upper(p_no) $$;

-- Reports for officials (export these to Excel/PDF from the API)
CREATE VIEW v_membership_register AS
SELECT m.membership_no, m.first_name, m.last_name, m.id_number, m.phone, m.email, m.designation,
       s.name AS sector, e.name AS employer, c.name AS county, m.workstation, m.status, m.date_joined, m.approved_at
  FROM members m
  LEFT JOIN service_sectors s ON s.code = m.sector_code
  LEFT JOIN employers e ON e.id = m.employer_id
  LEFT JOIN counties c ON c.id = m.county_id;

CREATE VIEW v_membership_stats AS
SELECT sector_code, county_id, status, COUNT(*) AS members FROM members GROUP BY 1, 2, 3;
-- Support for bulk-importing the Google Form registrations. Run after 03_membership_numbers.sql.
ALTER TABLE members
  ALTER COLUMN phone DROP NOT NULL,                 -- imported rows with an unusable phone are kept, flagged for follow-up
  ADD COLUMN payroll_no     text,
  ADD COLUMN registered_at  timestamptz,
  ADD COLUMN needs_review   boolean NOT NULL DEFAULT false,
  ADD COLUMN import_notes   text;

-- Approve verified applicants in the order they registered (earliest gets the lowest serial).
-- Skips anyone flagged needs_review or missing the data needed for the number. Returns how many were approved.
CREATE FUNCTION approve_members_bulk(p_staff uuid DEFAULT NULL, p_limit int DEFAULT 100000) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM members
            WHERE status = 'pending' AND NOT needs_review
            ORDER BY registered_at NULLS LAST, created_at LIMIT p_limit LOOP
    BEGIN
      PERFORM approve_member(r.id, p_staff);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;   -- leave this one pending for an official to fix
    END;
  END LOOP;
  RETURN n;
END $$;
-- Support for the API: Paybill/STK reconciliation. Run after 05_import_support.sql.
UPDATE dues_plans SET amount_kes = 500 WHERE name = 'Standard monthly dues' AND amount_kes = 300;  -- placeholder amount is KES 500

-- Paybill account number may be the full number (KNUMLO/CPS/001/047, slashes optional), KNUMLO001, or just the serial (001).
-- Safe against the same receipt arriving twice, including when an STK push also triggers a Paybill confirmation.
CREATE OR REPLACE FUNCTION record_c2b_payment(
  p_trans_id text, p_trans_time timestamptz, p_amount numeric, p_bill_ref text,
  p_msisdn text, p_payer_name text, p_raw jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_member uuid; v_pay uuid; k text := regexp_replace(upper(coalesce(p_bill_ref, '')), '[^A-Z0-9]', '', 'g');
BEGIN
  INSERT INTO mpesa_c2b_transactions (trans_id, trans_time, amount, bill_ref_number, msisdn, payer_name, raw_payload)
  VALUES (p_trans_id, p_trans_time, p_amount, p_bill_ref, p_msisdn, p_payer_name, p_raw)
  ON CONFLICT (trans_id) DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_member FROM members
   WHERE regexp_replace(upper(membership_no), '[^A-Z0-9]', '', 'g') = k
      OR 'KNUMLO' || lpad(membership_serial::text, 3, '0') = k
      OR (k ~ '^[0-9]{1,6}$' AND membership_serial = k::int);
  IF v_member IS NULL THEN RETURN NULL; END IF;

  INSERT INTO payments (member_id, channel, status, amount, payer_phone, provider_ref)
  VALUES (v_member, 'mpesa_paybill', 'completed', p_amount, p_msisdn, p_trans_id)
  ON CONFLICT (provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_pay;
  IF v_pay IS NULL THEN   -- an STK payment already recorded this receipt
    SELECT id INTO v_pay FROM payments WHERE provider_ref = p_trans_id;
  END IF;
  UPDATE mpesa_c2b_transactions SET matched_member_id = v_member, payment_id = v_pay WHERE trans_id = p_trans_id;
  RETURN v_pay;
END $$;

-- Called when Safaricom reports the result of an STK push.
CREATE FUNCTION complete_stk(p_checkout text, p_code int, p_desc text, p_receipt text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_pay uuid;
BEGIN
  UPDATE mpesa_stk_requests SET result_code = p_code, result_desc = p_desc, callback_payload = p_payload
   WHERE checkout_request_id = p_checkout RETURNING payment_id INTO v_pay;
  IF v_pay IS NULL THEN RETURN; END IF;
  IF p_code = 0 THEN
    IF EXISTS (SELECT 1 FROM payments WHERE provider_ref = p_receipt AND id <> v_pay) THEN
      UPDATE payments SET status = 'cancelled', notes = 'Duplicate of Paybill confirmation ' || p_receipt
       WHERE id = v_pay AND status = 'pending';       -- the Paybill confirmation already counted it
    ELSE
      UPDATE payments SET status = 'completed', provider_ref = p_receipt WHERE id = v_pay AND status = 'pending';
    END IF;
  ELSE
    UPDATE payments SET status = 'failed', notes = p_desc WHERE id = v_pay AND status = 'pending';
  END IF;
END $$;
