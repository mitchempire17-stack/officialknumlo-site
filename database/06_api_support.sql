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
