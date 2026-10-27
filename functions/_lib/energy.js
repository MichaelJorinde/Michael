// Maandelijks verbruik en kosten op basis van cumulatieve meterstanden.
export const METERS = ['elec_t1', 'elec_t2', 'inj_t1', 'inj_t2', 'gas', 'water'];
export const TARIFF_FIELDS = ['elec_day', 'elec_night', 'elec_injection', 'gas', 'gas_factor', 'water', 'fixed_elec', 'fixed_gas', 'fixed_water'];

const DAY_MS = 86400000;
// Een stand geldt aan het einde van de dag waarop hij genoteerd is.
const readingTime = (date) => Date.parse(date) + DAY_MS;
const round = (v, d = 3) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

function series(readings, key) {
  return readings
    .filter((r) => r[key] != null)
    .map((r) => ({ t: readingTime(r.reading_date), v: r[key] }))
    .sort((a, b) => a.t - b.t);
}

function valueAt(pts, t) {
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return pts[pts.length - 1].v;
}

// Verbruik van één meter tussen [s, e), begrensd tot de periode met standen.
function usage(pts, s, e) {
  if (pts.length < 2) return null;
  const a = Math.max(s, pts[0].t);
  const b = Math.min(e, pts[pts.length - 1].t);
  if (b <= a) return null;
  return { amount: valueAt(pts, b) - valueAt(pts, a), coverage: (b - a) / (e - s) };
}

function tariffFor(tariffs, monthStart) {
  if (!tariffs.length) return null;
  const sorted = [...tariffs].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  let found = sorted[0];
  for (const t of sorted) if (t.valid_from <= monthStart) found = t;
  return found;
}

const monthKey = (d) => d.toISOString().slice(0, 7);

export function monthlyOverview(readings, tariffs) {
  const pts = Object.fromEntries(METERS.map((k) => [k, series(readings, k)]));
  const times = METERS.flatMap((k) => pts[k].map((p) => p.t));
  if (!times.length) return [];
  const first = new Date(Math.min(...times) - DAY_MS);
  const last = new Date(Math.max(...times) - DAY_MS);

  const months = [];
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth();
    y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth());
    m === 11 ? (y++, m = 0) : m++) {
    const s = Date.UTC(y, m, 1);
    const e = Date.UTC(y, m + 1, 1);
    const key = monthKey(new Date(s));
    const tariff = tariffFor(tariffs, `${key}-01`);
    const u = Object.fromEntries(METERS.map((k) => [k, usage(pts[k], s, e)]));

    const amt = (k) => u[k]?.amount ?? 0;
    const cov = (...keys) => Math.max(0, ...keys.map((k) => u[k]?.coverage ?? 0));
    const has = (...keys) => keys.some((k) => u[k]);

    let elec = null;
    if (has('elec_t1', 'elec_t2', 'inj_t1', 'inj_t2')) {
      const c = cov('elec_t1', 'elec_t2', 'inj_t1', 'inj_t2');
      const day = amt('elec_t1');
      const night = amt('elec_t2');
      const injection = amt('inj_t1') + amt('inj_t2');
      elec = {
        day: round(day), night: round(night), injection: round(injection),
        usage: round(day + night), net: round(day + night - injection), coverage: round(c, 3),
        cost: tariff ? round(day * tariff.elec_day + night * tariff.elec_night - injection * tariff.elec_injection + tariff.fixed_elec * c, 2) : null,
      };
    }
    const simple = (k, price, fixed, t = tariff) => {
      if (!u[k]) return null;
      const c = u[k].coverage;
      return { usage: round(u[k].amount), coverage: round(c, 3), cost: t ? round(u[k].amount * t[price] + t[fixed] * c, 2) : null };
    };
    // Gas wordt meestal per kWh aangerekend: m³ × omrekenfactor (kWh/m³) × €/kWh.
    const gasTariff = tariff && { ...tariff, gas_eff: tariff.gas_factor > 0 ? tariff.gas * tariff.gas_factor : tariff.gas };
    const gas = simple('gas', 'gas_eff', 'fixed_gas', gasTariff);
    const water = simple('water', 'water', 'fixed_water');
    const costs = [elec, gas, water].filter((x) => x && x.cost != null).map((x) => x.cost);
    months.push({
      month: key,
      partial: [elec, gas, water].some((x) => x && x.coverage < 0.95),
      elec, gas, water,
      total: costs.length ? round(costs.reduce((a, b) => a + b, 0), 2) : null,
    });
  }
  return months.filter((m) => m.elec || m.gas || m.water);
}
