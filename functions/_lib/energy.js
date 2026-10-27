// Kosten per maand op basis van het ingegeven maandverbruik en de tarieven.
export const USAGE_FIELDS = ['elec_import', 'elec_export', 'gas', 'water'];
export const TARIFF_FIELDS = ['elec_import', 'elec_export', 'gas', 'water', 'fixed_elec', 'fixed_gas', 'fixed_water'];

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// Tarief dat geldt in een maand: het laatste dat start in of vóór die maand;
// is er geen, dan het oudste (je eerste tarief geldt ook voor eerdere maanden).
export function tariffFor(tariffs, month) {
  const sorted = [...tariffs].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  let found = sorted[0] || null;
  for (const t of sorted) if (t.valid_from.slice(0, 7) <= month) found = t;
  return found;
}

export function monthlyOverview(rows, tariffs) {
  return [...rows].sort((a, b) => a.month.localeCompare(b.month)).map((r) => {
    const t = tariffFor(tariffs, r.month);
    let elec = null;
    if (r.elec_import != null || r.elec_export != null) {
      const imp = r.elec_import ?? 0;
      const exp = r.elec_export ?? 0;
      elec = {
        import: imp, export: exp, net: round(imp - exp, 3),
        cost: t ? round(imp * t.elec_import - exp * t.elec_export + t.fixed_elec) : null,
      };
    }
    const gas = r.gas == null ? null : { usage: r.gas, cost: t ? round(r.gas * t.gas + t.fixed_gas) : null };
    // Water wordt in liter ingegeven, de prijs is per m³.
    const water = r.water == null ? null : { usage: r.water, cost: t ? round((r.water / 1000) * t.water + t.fixed_water) : null };
    const costs = [elec, gas, water].filter((x) => x && x.cost != null).map((x) => x.cost);
    return {
      month: r.month, note: r.note, elec, gas, water,
      total: costs.length ? round(costs.reduce((a, b) => a + b, 0)) : null,
      tariffFrom: t ? t.valid_from : null,
    };
  });
}
