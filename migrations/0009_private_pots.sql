-- € Privé: potjes (vaste maandelijkse reserveringen en spaardoelen)
CREATE TABLE private_pots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  monthly     REAL    NOT NULL DEFAULT 0,   -- € per maand
  grp         TEXT    NOT NULL,             -- Vaste kosten / Sparen & doelen / Kinderen / Beleggen
  yearly_cost REAL,                         -- verwachte jaarkost (om te zien of het potje volstaat)
  purpose     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_private_pots_user ON private_pots(user_id, grp);
