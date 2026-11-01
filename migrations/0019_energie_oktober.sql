-- Maandverbruik oktober 2026 (HomeWizard): afname 359 kWh, injectie 222 kWh, gas 70,9 m³, water 4891 liter.
INSERT INTO energy_usage (user_id, month, elec_import, elec_export, gas, water)
SELECT id, '2026-10', 359, 222, 70.9, 4891 FROM users WHERE id = (SELECT MIN(id) FROM users)
ON CONFLICT(user_id, month) DO UPDATE SET
  elec_import = excluded.elec_import, elec_export = excluded.elec_export,
  gas = excluded.gas, water = excluded.water, updated_at = datetime('now');
