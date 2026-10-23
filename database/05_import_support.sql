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
