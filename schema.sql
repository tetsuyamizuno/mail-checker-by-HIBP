CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  email_hash TEXT,
  email_masked TEXT,
  ip_hash TEXT,
  status TEXT NOT NULL,
  message TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_ms ON audit_logs(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_email_hash_created ON audit_logs(email_hash, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_hash_created ON audit_logs(ip_hash, created_at_ms);

CREATE TABLE IF NOT EXISTS token_claims (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT,
  status TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  result_json TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_claims_status_updated ON token_claims(status, updated_at_ms);
