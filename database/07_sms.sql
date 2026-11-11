-- Bulk SMS campaigns and delivery log. Safe to run more than once.
ALTER TABLE members ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS sms_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid REFERENCES staff_users(id),
  message     text NOT NULL,
  sender_id   text,
  audience    jsonb NOT NULL DEFAULT '{}',
  recipients  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sms_messages (
  id                  bigserial PRIMARY KEY,
  campaign_id         uuid NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE,
  member_id           uuid REFERENCES members(id),
  phone               text NOT NULL,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  provider_message_id text,
  cost                text,
  error               text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_queue_idx ON sms_messages (campaign_id, status);
