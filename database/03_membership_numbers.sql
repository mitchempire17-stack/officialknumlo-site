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
