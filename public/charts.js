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
export function lineChart(el, { points, series, yFormat, yTick, dateFormat, zero = false }) {
  const W = Math.max(el.clientWidth, 260);
  const H = 220;
  const m = { t: 10, r: 10, b: 26, l: 50 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const times = points.map((p) => Date.parse(p.d));
  const t0 = times[0];
  const t1 = times[times.length - 1] === t0 ? t0 + 86400000 : times[times.length - 1];
  const vals = points.flatMap((p) => series.map((s) => p[s.key]));
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
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
    const base = y(Math.max(y0, Math.min(0, y1)));
    const area = s.area
      ? `<path d="${line}L${x(times[times.length - 1]).toFixed(1)},${base}L${x(t0).toFixed(1)},${base}Z" fill="${s.color}" opacity=".14"/>`
      : '';
    return `${area}<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  el.classList.add('ch');
  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))}">
      ${grid}${xLabels}${paths}
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
      dots[k].setAttribute('cx', px);
      dots[k].setAttribute('cy', y(points[i][s.key]));
    });
    cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="ch-tip-d">${esc(dateFormat(points[i].d, true))}</div>${series.map((s) => `
      <div class="ch-tip-r"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${esc(yFormat(points[i][s.key]))}</b></div>`).join('')}`;
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
 * items: [{ label, sub?, values: { [key]: number } }]
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
        const color = neg && s.negColor ? s.negColor : s.color;
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
