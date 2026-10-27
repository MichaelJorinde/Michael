-- Eenmalige import van Michaels energiegegevens (uit de HomeWizard-app) voor het
-- eerste account (laagste id). Bestaande gegevens worden niet overschreven.

-- Tarief TotalEnergies / Farys, geldig vanaf 1 mei 2026
INSERT INTO energy_tariffs (user_id, valid_from, elec_import, elec_export, gas, water)
SELECT id, '2026-05-01', 0.259, 0.009, 0.760, 5.910
FROM users
WHERE id = (SELECT MIN(id) FROM users)
  AND NOT EXISTS (SELECT 1 FROM energy_tariffs t WHERE t.user_id = users.id AND t.valid_from = '2026-05-01');

-- Maandverbruik januari–september 2026: afname kWh, injectie kWh, gas m³ (water nog niet beschikbaar)
INSERT INTO energy_usage (user_id, month, elec_import, elec_export, gas)
SELECT (SELECT MIN(id) FROM users), v.column1, v.column2, v.column3, v.column4
FROM (VALUES
  ('2026-01', 415, 97, 214),
  ('2026-02', 348, 102, 142),
  ('2026-03', 290, 325, 124),
  ('2026-04', 224, 400, 71.3),
  ('2026-05', 256, 369, 42.4),
  ('2026-06', 254, 372, 16.4),
  ('2026-07', 185, 420, 12.9),
  ('2026-08', 284, 336, 15.1),
  ('2026-09', 304, 285, 16.6)
) AS v
WHERE (SELECT MIN(id) FROM users) IS NOT NULL
ON CONFLICT(user_id, month) DO NOTHING;
