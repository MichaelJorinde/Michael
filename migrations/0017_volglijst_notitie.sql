-- Volglijst: korte notitie per aandeel (waarom je het volgt).
ALTER TABLE watchlist ADD COLUMN note TEXT;

-- Eerste account: SPDR MSCI ACWI IMI (Euronext Parijs), aangeraden door een financieel expert.
INSERT INTO watchlist (user_id, ticker, name, note)
SELECT id, 'IMIE.PA', 'SPDR MSCI ACWI IMI', 'Aanrader van een financieel expert, in het oog houden'
FROM users WHERE id = (SELECT MIN(id) FROM users)
ON CONFLICT(user_id, ticker) DO UPDATE SET note = excluded.note;
