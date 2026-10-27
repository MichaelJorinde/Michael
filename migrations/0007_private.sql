-- € Privé: pincode per gebruiker en ontgrendeling per sessie
ALTER TABLE users ADD COLUMN private_pin_hash TEXT;
ALTER TABLE sessions ADD COLUMN private_until INTEGER NOT NULL DEFAULT 0;
