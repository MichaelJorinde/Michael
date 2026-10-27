-- € Privé: bankverrichtingen, met enkel de strikt nodige gegevens
-- (geen rekeningnummers, saldo, adressen of mededelingen).
CREATE TABLE private_tx (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,              -- YYYY-MM-DD
  amount       REAL    NOT NULL,              -- negatief = uitgave
  counterparty TEXT    NOT NULL,              -- naam tegenpartij / handelaar (max. 40 tekens)
  category     TEXT    NOT NULL,
  fingerprint  TEXT    NOT NULL,              -- hash om dubbele import te vermijden
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX idx_private_tx_user ON private_tx(user_id, date);

-- Eigen categorie per tegenpartij (onthouden na een aanpassing)
CREATE TABLE private_rules (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key      TEXT    NOT NULL,
  category TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);
