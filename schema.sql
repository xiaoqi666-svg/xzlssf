CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  manage_token_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_expires_at
ON shares(expires_at);

CREATE INDEX IF NOT EXISTS idx_shares_revoked
ON shares(revoked);
