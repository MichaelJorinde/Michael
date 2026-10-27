-- Meterstanden (HomeWizard), cumulatieve tellerstanden
CREATE TABLE meter_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading_date TEXT    NOT NULL,
  elec_t1      REAL,  -- afname dag (kWh)
  elec_t2      REAL,  -- afname nacht (kWh)
  inj_t1       REAL,  -- injectie dag (kWh)
  inj_t2       REAL,  -- injectie nacht (kWh)
  gas          REAL,  -- m³
  water        REAL,  -- m³
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_readings_user ON meter_readings(user_id, reading_date);

-- Tarieven, geldig vanaf een datum
CREATE TABLE energy_tariffs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valid_from     TEXT    NOT NULL,
  elec_day       REAL    NOT NULL DEFAULT 0, -- €/kWh
  elec_night     REAL    NOT NULL DEFAULT 0, -- €/kWh
  elec_injection REAL    NOT NULL DEFAULT 0, -- €/kWh vergoeding
  gas            REAL    NOT NULL DEFAULT 0, -- €/kWh (met omrekenfactor) of €/m³ (zonder)
  gas_factor     REAL    NOT NULL DEFAULT 0, -- kWh per m³ (0 = prijs per m³)
  water          REAL    NOT NULL DEFAULT 0, -- €/m³
  fixed_elec     REAL    NOT NULL DEFAULT 0, -- €/maand
  fixed_gas      REAL    NOT NULL DEFAULT 0, -- €/maand
  fixed_water    REAL    NOT NULL DEFAULT 0  -- €/maand
);
CREATE INDEX idx_tariffs_user ON energy_tariffs(user_id, valid_from);
