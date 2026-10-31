-- Dagelijkse brandstofprijzen van het tankstation (Maes Buggenhout), voor de grafiek in Tanken.
CREATE TABLE fuel_prices (
  date       TEXT PRIMARY KEY,   -- YYYY-MM-DD (Belgische tijd)
  euro95     REAL,
  diesel     REAL,
  updated_at INTEGER NOT NULL
);
