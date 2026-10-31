-- Volglijst: aandelen/ETF's die je opvolgt zonder ze (al) te bezitten, met een koersalarm.
CREATE TABLE watchlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker      TEXT    NOT NULL,
  name        TEXT,
  alert_below REAL,              -- melding als de koers hieronder zakt
  alert_above REAL,              -- melding als de koers hierboven stijgt
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, ticker)
);

-- Eerste account: NVIDIA, melding onder $195.
INSERT INTO watchlist (user_id, ticker, name, alert_below)
SELECT id, 'NVDA', 'NVIDIA', 195 FROM users WHERE id = (SELECT MIN(id) FROM users)
ON CONFLICT(user_id, ticker) DO NOTHING;
