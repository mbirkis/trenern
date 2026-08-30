'use strict';

const TYPE_LABELS = {
  running: 'Løping', trailrunning: 'Terrengløp', hiking: 'Fjelltur',
  walking: 'Gåtur', cycling: 'Sykkel', skiing: 'Ski', other: 'Annet',
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const el = document.getElementById('stats-content');
  let data;
  try {
    data = await fetchJSON('/api/stats/by-year');
  } catch (e) {
    el.innerHTML = `<p class="detail-empty">Kunne ikke laste statistikk: ${escapeHtml(e.message)}</p>`;
    return;
  }
  const years = data.years || [];
  if (!years.length) {
    el.innerHTML = '<p class="detail-empty">Ingen økter registrert ennå.</p>';
    return;
  }
  el.innerHTML =
    yearTableHtml(years) +
    distanceChartHtml(years) +
    typeTableHtml(years);
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function yearTableHtml(years) {
  const now = new Date().getFullYear();
  const tot = years.reduce((s, y) => ({
    count: s.count + y.count,
    dist: s.dist + y.totalDistanceM,
    move: s.move + y.totalMovingTimeSec,
    gain: s.gain + y.totalElevationGainM,
  }), { count: 0, dist: 0, move: 0, gain: 0 });

  const row = (y) => `
    <tr class="${y.year === now ? 'is-current' : ''}">
      <td class="yr">${y.year}${y.year === now ? ' <span class="tag-now">i år</span>' : ''}</td>
      <td>${y.count}</td>
      <td>${km(y.totalDistanceM)}</td>
      <td>${y.count ? km(y.totalDistanceM / y.count) : '–'}</td>
      <td>${fmtDuration(y.totalMovingTimeSec)}</td>
      <td>${y.totalElevationGainM.toLocaleString('no')}</td>
    </tr>`;

  return `
  <h2>Per år</h2>
  <div class="table-wrap">
    <table class="stats-table">
      <thead><tr>
        <th>År</th><th>Økter</th><th>Distanse (km)</th>
        <th>Snitt/økt (km)</th><th>I bevegelse</th><th>Stigning (m)</th>
      </tr></thead>
      <tbody>${years.map(row).join('')}</tbody>
      <tfoot><tr>
        <td class="yr">Totalt</td>
        <td>${tot.count}</td>
        <td>${km(tot.dist)}</td>
        <td>${tot.count ? km(tot.dist / tot.count) : '–'}</td>
        <td>${fmtDuration(tot.move)}</td>
        <td>${tot.gain.toLocaleString('no')}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

function distanceChartHtml(years) {
  const now = new Date().getFullYear();
  const max = Math.max(...years.map((y) => y.totalDistanceM), 1);
  const asc = [...years].sort((a, b) => a.year - b.year);
  const bars = asc.map((y) => {
    const pct = (y.totalDistanceM / max) * 100;
    return `
      <div class="bar-row ${y.year === now ? 'is-current' : ''}">
        <span class="bar-label">${y.year}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct.toFixed(1)}%"></span></span>
        <span class="bar-value">${km(y.totalDistanceM)} km</span>
      </div>`;
  }).join('');
  return `<h2>Distanse per år</h2><div class="bar-chart">${bars}</div>`;
}

function typeTableHtml(years) {
  const now = new Date().getFullYear();
  const types = [...new Set(years.flatMap((y) => Object.keys(y.byType)))];
  if (!types.length) return '';
  const head = types.map((t) => `<th>${escapeHtml(TYPE_LABELS[t] || t)}</th>`).join('');
  const rows = years.map((y) => `
    <tr class="${y.year === now ? 'is-current' : ''}">
      <td class="yr">${y.year}</td>
      ${types.map((t) => `<td>${y.byType[t] || 0}</td>`).join('')}
    </tr>`).join('');
  return `
  <h2>Økter per type</h2>
  <div class="table-wrap">
    <table class="stats-table">
      <thead><tr><th>År</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function km(m) {
  return (m / 1000).toLocaleString('no', { maximumFractionDigits: 1 });
}
function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}t ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
