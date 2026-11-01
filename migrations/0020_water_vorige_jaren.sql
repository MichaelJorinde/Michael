-- Waterverbruik vorige jaren uit de Farys-afrekeningen (m³ per 365 dagen), gelijk verdeeld over 12 maanden:
-- nov 2022–okt 2023: 60 m³, nov 2023–okt 2024: 57 m³, nov 2024–okt 2025: 65 m³. Enkel water; een al gekende waarde blijft staan.
INSERT INTO energy_usage (user_id, month, water, note)
SELECT (SELECT MIN(id) FROM users), v.column1, v.column2, 'Water: schatting (jaartotaal Farys ÷ 12)'
FROM (VALUES
  ('2022-11', 5000),
  ('2022-12', 5000),
  ('2023-01', 5000),
  ('2023-02', 5000),
  ('2023-03', 5000),
  ('2023-04', 5000),
  ('2023-05', 5000),
  ('2023-06', 5000),
  ('2023-07', 5000),
  ('2023-08', 5000),
  ('2023-09', 5000),
  ('2023-10', 5000),
  ('2023-11', 4750),
  ('2023-12', 4750),
  ('2024-01', 4750),
  ('2024-02', 4750),
  ('2024-03', 4750),
  ('2024-04', 4750),
  ('2024-05', 4750),
  ('2024-06', 4750),
  ('2024-07', 4750),
  ('2024-08', 4750),
  ('2024-09', 4750),
  ('2024-10', 4750),
  ('2024-11', 5417),
  ('2024-12', 5417),
  ('2025-01', 5417),
  ('2025-02', 5417),
  ('2025-03', 5417),
  ('2025-04', 5417),
  ('2025-05', 5417),
  ('2025-06', 5417),
  ('2025-07', 5417),
  ('2025-08', 5417),
  ('2025-09', 5417),
  ('2025-10', 5417)
) AS v
WHERE (SELECT MIN(id) FROM users) IS NOT NULL
ON CONFLICT(user_id, month) DO UPDATE SET water = COALESCE(energy_usage.water, excluded.water);
