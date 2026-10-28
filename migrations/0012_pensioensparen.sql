-- Het "effectenplan" is pensioensparen (BNPP B Pension Balanced); enkel naam en omschrijving.
UPDATE private_pots SET name = 'Pensioensparen', purpose = 'BNPP B Pension Balanced · 3% instapkost per storting'
WHERE user_id = (SELECT MIN(id) FROM users) AND name LIKE 'Beleggen%effectenplan%';
