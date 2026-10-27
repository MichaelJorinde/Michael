-- De voorschotten bij TotalEnergies lopen sinds 1 mei 2026 (elektriciteit + gas),
-- dus de afrekeningsperiode loopt van mei tot april. Enkel aanpassen als de
-- startwaarde uit 0005 nog ongewijzigd is.
UPDATE energy_settings
SET period_start = '2026-05'
WHERE user_id = (SELECT MIN(id) FROM users)
  AND period_start = '2026-01' AND advance = 160 AND covers = 'elec,gas';
