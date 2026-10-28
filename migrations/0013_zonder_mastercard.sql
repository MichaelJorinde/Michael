-- Mastercard is geen vaste kost of potje; verwijderen als het al geïmporteerd werd.
DELETE FROM private_pots WHERE user_id = (SELECT MIN(id) FROM users) AND name LIKE 'Mastercard%';
