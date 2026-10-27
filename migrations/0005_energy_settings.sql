-- Voorschot en afrekeningsperiode per gebruiker
CREATE TABLE energy_settings (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  advance      REAL    NOT NULL DEFAULT 0,          -- voorschot €/maand
  covers       TEXT    NOT NULL DEFAULT 'elec,gas', -- onderdelen die het voorschot dekt
  period_start TEXT    NOT NULL                     -- YYYY-MM: eerste maand van de afrekeningsperiode
);

-- Startwaarden voor het eerste account: €160/maand voor elektriciteit en gas, per kalenderjaar
INSERT INTO energy_settings (user_id, advance, covers, period_start)
SELECT id, 160, 'elec,gas', '2026-01' FROM users
WHERE id = (SELECT MIN(id) FROM users)
ON CONFLICT(user_id) DO NOTHING;
