-- Gedeelde potjes: 'share' = jouw aandeel in de inleg (1 = alleen jij, 0.5 = helft)
ALTER TABLE private_pots ADD COLUMN share REAL NOT NULL DEFAULT 1;

-- Op vraag van de eigenaar: de potjes voor de onroerende voorheffing en Touring
-- worden 50/50 gedeeld met de partner (enkel het aandeel, geen bedragen).
UPDATE private_pots SET share = 0.5
WHERE user_id = (SELECT MIN(id) FROM users)
  AND (name LIKE 'Onroerende voorheffing%' OR name LIKE 'Touring%');
