-- Gebruikers
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sessies (enkel de SHA-256 hash van het token wordt bewaard)
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Mislukte loginpogingen (brute-force bescherming)
CREATE TABLE login_failures (
  email TEXT    NOT NULL COLLATE NOCASE,
  at    INTEGER NOT NULL
);
CREATE INDEX idx_login_failures_email ON login_failures(email, at);

-- Aankopen
CREATE TABLE purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker        TEXT    NOT NULL,
  name          TEXT,
  purchase_date TEXT    NOT NULL,
  quantity      REAL    NOT NULL,
  price         REAL    NOT NULL,
  fees          REAL    NOT NULL DEFAULT 0,
  currency      TEXT    NOT NULL DEFAULT 'EUR',
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_purchases_user ON purchases(user_id, ticker);

-- Gedeelde cache van marktkoersen
CREATE TABLE prices (
  ticker     TEXT    PRIMARY KEY,
  price      REAL    NOT NULL,
  currency   TEXT,
  name       TEXT,
  updated_at INTEGER NOT NULL
);

-- Manuele koers per gebruiker (overschrijft marktkoers)
CREATE TABLE user_prices (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker     TEXT    NOT NULL,
  price      REAL    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ticker)
);
