-- Water heeft een eigen voorschot (Farys, per kwartaal), los van elektriciteit en gas.
ALTER TABLE energy_settings ADD COLUMN water_advance REAL NOT NULL DEFAULT 0;

-- Eerste account: €120 per kwartaal = €40 per maand.
UPDATE energy_settings SET water_advance = 40 WHERE user_id = (SELECT MIN(id) FROM users);
