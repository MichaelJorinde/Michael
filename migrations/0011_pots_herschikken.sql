-- Potjes herschikken (enkel namen en soort, geen bedragen).
UPDATE private_pots SET grp = 'Sparen & doelen'
WHERE user_id = (SELECT MIN(id) FROM users) AND name LIKE 'Kampen%hobby%';

UPDATE private_pots SET name = 'Sparen grasrobot'
WHERE user_id = (SELECT MIN(id) FROM users) AND name LIKE 'Onderhoud grasrobot%';

-- Geen lopende betalingen meer: reserve die opzij staat, dus spaarpotje zonder jaarkost.
UPDATE private_pots SET name = name || ' (sparen extra)', grp = 'Sparen & doelen', yearly_cost = NULL
WHERE user_id = (SELECT MIN(id) FROM users)
  AND (name LIKE 'Schuldsaldo%' OR name LIKE 'Brandverzekering%')
  AND name NOT LIKE '%(sparen extra)%';
