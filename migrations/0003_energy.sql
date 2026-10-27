-- Maandelijks totaalverbruik (overgenomen uit de HomeWizard-app)
CREATE TABLE energy_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT    NOT NULL,  -- YYYY-MM
  elec_import REAL,              -- afname (kWh)
  elec_export REAL,              -- injectie (kWh)
  gas         REAL,              -- m³
  water       REAL,              -- liter
  note        TEXT,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month)
);

-- Tarieven, geldig vanaf een datum (vanaf de maand waarin die datum valt)
CREATE TABLE energy_tariffs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valid_from  TEXT    NOT NULL,
  elec_import REAL    NOT NULL DEFAULT 0, -- €/kWh afname
  elec_export REAL    NOT NULL DEFAULT 0, -- €/kWh injectievergoeding
  gas         REAL    NOT NULL DEFAULT 0, -- €/m³
  water       REAL    NOT NULL DEFAULT 0, -- €/m³
  fixed_elec  REAL    NOT NULL DEFAULT 0, -- €/maand
  fixed_gas   REAL    NOT NULL DEFAULT 0, -- €/maand
  fixed_water REAL    NOT NULL DEFAULT 0  -- €/maand
);
CREATE INDEX idx_tariffs_user ON energy_tariffs(user_id, valid_from);
