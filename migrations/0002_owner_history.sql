-- Voor wie is de aankoop bedoeld (bv. jezelf of een kind)
ALTER TABLE purchases ADD COLUMN owner TEXT;
UPDATE purchases SET owner = (SELECT name FROM users WHERE users.id = purchases.user_id) WHERE owner IS NULL;
CREATE INDEX idx_purchases_owner ON purchases(user_id, owner);

-- Historische slotkoersen voor de grafieken
CREATE TABLE price_history (
  ticker TEXT NOT NULL,
  date   TEXT NOT NULL,
  close  REAL NOT NULL,
  PRIMARY KEY (ticker, date)
);

CREATE TABLE history_meta (
  ticker     TEXT    PRIMARY KEY,
  from_date  TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL
);
