// Kleine SVG/HTML-grafieken zonder externe bibliotheek.
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/**
 * Lijngrafiek met crosshair + tooltip (aanraken of muis).
 * points: [{ d: 'YYYY-MM-DD', ...waarden }]
 * series: [{ key, label, color, area? }]
 */
export function lineChart(el, { points, series, yFormat, yTick, dateFormat, zero = false, refLines = [], markers = [] }) {
  const W = Math.max(el.clientWidth, 260);
  const H = 220;
  const m = { t: 10, r: 10, b: 26, l: 50 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const times = points.map((p) => Date.parse(p.d));
  const t0 = times[0];
  const t1 = times[times.length - 1] === t0 ? t0 + 86400000 : times[times.length - 1];
  const vals = points.flatMap((p) => series.map((s) => p[s.key])).filter((v) => v != null);
  refLines.forEach((r) => vals.push(r.value));
  if (zero) vals.push(0);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const grid = ticks.map((v) => `
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 && zero ? 'ch-zero' : 'ch-grid'}"/>
    <text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ch-axis">${esc(yTick(v))}</text>`).join('');

  const xIdx = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1];
  const xLabels = [...new Set(xIdx)].map((i, n, arr) => `
    <text x="${x(times[i])}" y="${H - 6}" class="ch-axis"
      text-anchor="${n === 0 ? 'start' : n === arr.length - 1 ? 'end' : 'middle'}">${esc(dateFormat(points[i].d))}</text>`).join('');

  const paths = series.map((s) => {
    // Lege waarden (null) onderbreken de lijn, bv. een voortschrijdend gemiddelde aan het begin.
    let pen = 'M';
    const line = points.map((p, i) => {
      if (p[s.key] == null) { pen = 'M'; return ''; }
      const seg = `${pen}${x(times[i]).toFixed(1)},${y(p[s.key]).toFixed(1)}`;
      pen = 'L';
      return seg;
    }).join('');
    const base = y(Math.max(y0, Math.min(0, y1)));
    const area = s.area
      ? `<path d="${line}L${x(times[times.length - 1]).toFixed(1)},${base}L${x(t0).toFixed(1)},${base}Z" fill="${s.color}" opacity=".14"/>`
      : '';
    return `${area}<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const refs = refLines.map((r) => `
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(r.value)}" y2="${y(r.value)}" class="cc-ref"/>
    <text x="${m.l + 4}" y="${y(r.value) - 5}" class="ch-axis cc-ref-label">${esc(r.label)}</text>`).join('');
  const marks = markers.filter((mk) => Date.parse(mk.d) >= t0 && Date.parse(mk.d) <= t1).map((mk) => `
    <circle cx="${x(Date.parse(mk.d))}" cy="${y(mk.v)}" r="5" class="ch-marker"><title>${esc(mk.label)}</title></circle>`).join('');

  el.classList.add('ch');
  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))}">
      ${grid}${xLabels}${refs}${paths}${marks}
      <g class="ch-cross" visibility="hidden">
        <line y1="${m.t}" y2="${m.t + ih}" class="ch-crossline"/>
        ${series.map((s) => `<circle r="4.5" fill="${s.color}" class="ch-dot"/>`).join('')}
      </g>
      <rect x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent" class="ch-hit"/>
    </svg>
    <div class="ch-tip" hidden></div>`;

  const svg = el.querySelector('svg');
  const cross = svg.querySelector('.ch-cross');
  const dots = cross.querySelectorAll('circle');
  const crossLine = cross.querySelector('line');
  const tip = el.querySelector('.ch-tip');

  function show(clientX) {
    const rect = svg.getBoundingClientRect();
    const t = t0 + ((clientX - rect.left - m.l) / iw) * (t1 - t0);
    let i = 0;
    for (let k = 1; k < times.length; k++) if (Math.abs(times[k] - t) < Math.abs(times[i] - t)) i = k;
    const px = x(times[i]);
    crossLine.setAttribute('x1', px);
    crossLine.setAttribute('x2', px);
    series.forEach((s, k) => {
      const v = points[i][s.key];
      dots[k].setAttribute('visibility', v == null ? 'hidden' : 'inherit');
      dots[k].setAttribute('cx', px);
      if (v != null) dots[k].setAttribute('cy', y(v));
    });
    const buys = markers.filter((mk) => mk.d === points[i].d);
    cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="ch-tip-d">${esc(dateFormat(points[i].d, true))}</div>${series.filter((s) => points[i][s.key] != null).map((s) => `
      <div class="ch-tip-r"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${esc(yFormat(points[i][s.key]))}</b></div>`).join('')}
      ${buys.map((mk) => `<div class="ch-tip-r ch-tip-total"><i class="ch-tip-marker"></i><span>${esc(mk.label)}</span></div>`).join('')}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(px - tw / 2, 0), W - tw)}px`;
  }
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const hit = svg.querySelector('.ch-hit');
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}

/**
 * Horizontale staafgrafiek (HTML), ondersteunt negatieve waarden en meerdere reeksen.
 * items: [{ label, sub?, color?, values: { [key]: number } }]
 * series: [{ key, label, color, negColor? }]
 */
export function barChart({ items, series, format }) {
  const all = items.flatMap((it) => series.map((s) => it.values[s.key] ?? 0));
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const span = max - min || 1;
  const zero = (-min / span) * 100;
  return `<div class="bc">${items.map((it) => `
    <div class="bc-row">
      <div class="bc-label"><b>${esc(it.label)}</b>${it.sub ? ` <span>${esc(it.sub)}</span>` : ''}</div>
      ${series.map((s) => {
        const v = it.values[s.key] ?? 0;
        const w = (Math.abs(v) / span) * 100;
        const neg = v < 0;
        const color = it.color || (neg && s.negColor ? s.negColor : s.color);
        return `<div class="bc-line" title="${esc(`${s.label}: ${format(v)}`)}">
          <div class="bc-track">
            ${min < 0 ? `<span class="bc-zero" style="left:${zero}%"></span>` : ''}
            <span class="bc-bar ${neg ? 'neg' : ''}" style="left:${neg ? zero - w : zero}%;width:${Math.max(w, 0.8)}%;background:${color}"></span>
          </div>
          <span class="bc-val">${esc(format(v))}</span>
        </div>`;
      }).join('')}
    </div>`).join('')}</div>`;
}

export function legend(series) {
  return `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}

// Pad voor een staaf met afgeronde uiteinden aan de kant weg van de nullijn.
function barPath(x, y, w, h, roundTop, roundBottom) {
  const r = Math.min(4, w / 2, h);
  const rt = roundTop ? r : 0;
  const rb = roundBottom ? r : 0;
  return `M${x},${y + rt}a${rt},${rt} 0 0 1 ${rt},${-rt}h${w - 2 * rt}a${rt},${rt} 0 0 1 ${rt},${rt}`
    + `v${h - rt - rb}a${rb},${rb} 0 0 1 ${-rb},${rb}h${-(w - 2 * rb)}a${rb},${rb} 0 0 1 ${-rb},${-rb}Z`;
}

/**
 * Kolomgrafiek (SVG), gestapeld, met negatieve waarden onder de nullijn.
 * labels: ['jan', ...]; rows: [{ [key]: number } | null]; series: [{ key, label, color }]
 */
export function columnChart(el, { labels, longLabels = labels, rows, series, format, tickFormat, totalLabel = 'Totaal', refLine = null, faded = [] }) {
  const W = Math.max(el.clientWidth, 260);
  const H = 220;
  const m = { t: 10, r: 4, b: 24, l: 48 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = labels.length;

  const sums = rows.map((r) => {
    if (!r) return { pos: 0, neg: 0 };
    let pos = 0;
    let neg = 0;
    series.forEach((s) => { const v = r[s.key] ?? 0; if (v > 0) pos += v; else neg += v; });
    return { pos, neg };
  });
  const ticks = niceTicks(Math.min(0, ...sums.map((s) => s.neg)), Math.max(0, ...sums.map((s) => s.pos), refLine ? refLine.value * 1.08 : 0, 0.0001));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const slot = iw / n;
  const bw = Math.min(26, slot * 0.64);

  const grid = ticks.map((v) => `
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'ch-zero' : 'ch-grid'}"/>
    <text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ch-axis">${esc(tickFormat(v))}</text>`).join('');
  const every = n > 12 ? Math.ceil(n / 12) : 1;
  const xLabels = labels.map((l, i) => (i % every ? '' : `
    <text x="${m.l + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle" class="ch-axis">${esc(l)}</text>`)).join('');

  const cols = rows.map((r, i) => {
    if (!r) return '';
    const x = m.l + slot * i + (slot - bw) / 2;
    const pos = series.filter((s) => (r[s.key] ?? 0) > 0);
    const neg = series.filter((s) => (r[s.key] ?? 0) < 0);
    let up = 0;
    let down = 0;
    const segs = [
      ...pos.map((s, k) => {
        const v = r[s.key];
        const top = y(up + v);
        const h = y(up) - top;
        up += v;
        return `<path d="${barPath(x, top, bw, h, k === pos.length - 1, false)}" fill="${s.color}" class="cc-seg"/>`;
      }),
      ...neg.map((s, k) => {
        const v = r[s.key];
        const top = y(down);
        const h = y(down + v) - top;
        down += v;
        return `<path d="${barPath(x, top, bw, h, false, k === neg.length - 1)}" fill="${s.color}" class="cc-seg"/>`;
      }),
    ].join('');
    return `<g class="cc-col${faded[i] ? ' faded' : ''}" data-i="${i}">${segs}</g>`;
  }).join('');

  el.classList.add('ch');
  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))}">
      ${grid}${xLabels}${cols}
      ${refLine ? `<line x1="${m.l}" x2="${W - m.r}" y1="${y(refLine.value)}" y2="${y(refLine.value)}" class="cc-ref"/>
        <text x="${W - m.r}" y="${y(refLine.value) - 5}" text-anchor="end" class="ch-axis cc-ref-label">${esc(refLine.label)}</text>` : ''}
      ${rows.map((r, i) => (r ? `<rect x="${m.l + slot * i}" y="0" width="${slot}" height="${H}" fill="transparent" class="cc-hit" data-i="${i}"/>` : '')).join('')}
    </svg>
    <div class="ch-tip" hidden></div>`;

  const svg = el.querySelector('svg');
  const tip = el.querySelector('.ch-tip');
  const showCol = (i) => {
    const r = rows[i];
    svg.querySelectorAll('.cc-col').forEach((g) => g.classList.toggle('dim', g.dataset.i !== String(i)));
    const visible = series.filter((s) => r[s.key] != null);
    const total = visible.reduce((a, s) => a + r[s.key], 0);
    tip.innerHTML = `<div class="ch-tip-d">${esc(longLabels[i])}${faded[i] ? ' (schatting)' : ''}</div>${visible.map((s) => `
      <div class="ch-tip-r"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${esc(format(r[s.key]))}</b></div>`).join('')}
      ${visible.length > 1 ? `<div class="ch-tip-r ch-tip-total"><i></i><span>${esc(totalLabel)}</span><b>${esc(format(total))}</b></div>` : ''}`;
    tip.hidden = false;
    const cx = m.l + slot * i + slot / 2;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(cx - tw / 2, 0), W - tw)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    svg.querySelectorAll('.cc-col').forEach((g) => g.classList.remove('dim'));
  };
  svg.querySelectorAll('.cc-hit').forEach((h) => {
    h.addEventListener('pointerdown', () => showCol(Number(h.dataset.i)));
    h.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showCol(Number(h.dataset.i)); });
  });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}
