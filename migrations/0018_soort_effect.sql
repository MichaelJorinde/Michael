-- Soort effect zoals de koersbron het meldt (bv. ETF of EQUITY = aandeel), om ze in de app te onderscheiden.
ALTER TABLE prices ADD COLUMN kind TEXT;
