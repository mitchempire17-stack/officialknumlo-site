#!/usr/bin/env bash
# Sets up the KNUMLO database once and creates the first administrator. Safe to run again.
# Needs: DATABASE_URL. Optional: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME.
set -euo pipefail
cd "$(dirname "$0")"
if psql "$DATABASE_URL" -tAc "select to_regclass('public.members')" | grep -q members; then
  echo "Database tables already exist. Skipping schema."
else
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f all.sql
  echo "Database tables created."
fi
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  if [ "${#ADMIN_PASSWORD}" -lt 10 ]; then echo "ADMIN_PASSWORD must be at least 10 characters."; exit 1; fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -v email="$ADMIN_EMAIL" -v name="${ADMIN_NAME:-Administrator}" -v pw="$ADMIN_PASSWORD" <<'SQL'
INSERT INTO staff_users (full_name, email, password_hash, role)
VALUES (:'name', :'email', crypt(:'pw', gen_salt('bf', 12)), 'super_admin')
ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'super_admin', active = true;
SQL
  echo "Administrator account ready: $ADMIN_EMAIL"
else
  echo "ADMIN_EMAIL / ADMIN_PASSWORD not set. No administrator created."
fi
