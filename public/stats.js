'use strict';

const TYPE_LABELS = {
  running: 'Løping', trailrunning: 'Terrengløp', hiking: 'Fjelltur',
  walking: 'Gåtur', cycling: 'Sykkel', skiing: 'Ski', swimming: 'Svømming', strength: 'Styrke', yoga: 'Yoga', other: 'Annet',
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
    await initHealth();
    return;
  }
  el.innerHTML =
    yearTableHtml(years) +
    distanceChartHtml(years) +
    typeTableHtml(years) + extendedStatsHtml(years);
  await initHealth();
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


function extendedStatsHtml(years) {
  const totals = [
    ['totalDurationSec', 'Total varighet', fmtDuration],
    ['totalPauseTimeSec', 'Pausetid', fmtDuration],
    ['totalElevationLossM', 'Nedstigning (m)', v => v.toLocaleString('no')],
    ['totalCalories', 'Kalorier (kcal)', v => v.toLocaleString('no')],
    ['totalSteps', 'Skritt', v => v.toLocaleString('no')],
  ];
  const averageLabels = {avgHr: 'Snittpuls (bpm)', avgCadence: 'Kadens (/min)', avgPower: 'Effekt (W)', avgTempC: 'Temperatur (°C)'};
  const averages = [...new Set(years.flatMap(y => Object.keys(y.averages || {})))];
  const head = [...totals.map(([,label]) => label), ...averages.map(k => averageLabels[k] || (GarminView.metricLabels[k.replace('metrics.','')] || [k])[0])];
  const rows = years.map(y => `<tr><td>${y.year}</td>${totals.map(([k,,fmt]) => {
    const field = {totalElevationLossM: 'elevationLossM', totalCalories: 'calories', totalSteps: 'steps'}[k];
    return `<td>${field && !y.coverage?.[field] ? '–' : fmt(y[k] || 0)}</td>`;
  }).join('')}${averages.map(k => `<td>${y.averages?.[k] == null ? '–' : GarminView.format(y.averages[k])}</td>`).join('')}</tr>`).join('');
  const zoneRows = years.map(y => `<tr><td>${y.year}</td>${[1,2,3,4,5].map(z => `<td>${fmtDuration(y.hrZones?.[z] || 0)}</td>`).join('')}</tr>`).join('');
  return `<h2>Flere treningsmål per år</h2><p class="health-status">Puls, kadens, effekt og temperatur er vektet etter bevegelsestid. Øvrige gjennomsnitt gjelder økter med data. Manglende målinger vises som –.</p>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>År</th>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Tid i pulssoner per år</h2><p class="health-status">Garmin-soner brukes der de finnes, ellers appens beregnede soner. Sonegrensene kan variere mellom økter.</p>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>År</th>${[1,2,3,4,5].map(z => `<th>Z${z}</th>`).join('')}</tr></thead><tbody>${zoneRows}</tbody></table></div>`;
}

async function initHealth() {
  const section = document.createElement('section'); section.id = 'health-content';
  document.getElementById('stats-content').append(section);
  section.innerHTML = `<h2>Garmin · helse og restitusjon</h2>
    <div class="health-controls"><label>Fra <input id="health-from" type="date"></label><label>Til <input id="health-to" type="date"></label><button id="health-load">Vis periode</button></div>
    <div id="health-results"><p class="detail-empty">Laster helsedata …</p></div>`;
  const today = new Date();
  document.getElementById('health-to').value = today.toLocaleDateString('sv-SE');
  document.getElementById('health-from').value = new Date(today.getTime()-29*86400000).toLocaleDateString('sv-SE');
  const load = async () => {
    const el = document.getElementById('health-results');
    const from = document.getElementById('health-from').value, to = document.getElementById('health-to').value;
    if (!from || !to || from > to) { el.innerHTML = '<p>Velg en gyldig periode.</p>'; return; }
    try {
      const {days} = await fetchJSON(`/api/garmin/health?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!days.length) { el.innerHTML = '<p class="detail-empty">Ingen Garmin-helsedata i perioden. Synk Garmin-kilden for å hente data.</p>'; return; }
      const sources = [...new Set(days.map(d => d.source))];
      el.innerHTML = `<div class="health-controls"><label>Kilde <select id="health-source">${sources.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select></label><label>Dag <select id="health-day"></select></label></div><div id="health-trends"></div><div id="health-day-detail"></div>`;
      const draw = () => {
        const source = document.getElementById('health-source').value;
        const own = days.filter(d => d.source === source);
        document.getElementById('health-day').innerHTML = own.map(d => `<option value="${d.date}">${d.date}</option>`).join('');
        document.getElementById('health-trends').innerHTML = healthTrendsHtml(own);
        const detail = () => {
          GarminView.reset();
          const d = own.find(d => d.date === document.getElementById('health-day').value);
          document.getElementById('health-day-detail').innerHTML = `<h3>${d.date}</h3><p class="health-status">Sist hentet ${escapeHtml(new Date(d.ingestedAt).toLocaleString('no'))}. Målinger avhenger av klokke og bruk. Ved hentefeil kan tidligere målinger være beholdt.</p><div class="metric-grid">${GarminView.healthMetrics(d.data)}</div>${GarminView.statusHtml(d.endpointStatus)}<h3>Alle målinger for dagen</h3>${Object.entries(d.data || {}).map(([k,v]) => GarminView.tree(k,v)).join('')}`;
        };
        document.getElementById('health-day').onchange = detail; detail();
      };
      document.getElementById('health-source').onchange = draw; draw();
    } catch (e) { el.innerHTML = `<p>Kunne ikke hente helsedata: ${escapeHtml(e.message)}</p>`; }
  };
  document.getElementById('health-load').onclick = load;
  await load();
}
function healthTrendsHtml(days) {
  const columns = [
    ['Skritt', 'daily', ['totalSteps']], ['Kalorier', 'daily', ['totalKilocalories']],
    ['Hvilepuls', 'heartRate', ['restingHeartRate']], ['Søvn (t)', 'sleep', ['sleepTimeSeconds'], 3600],
    ['HRV (ms)', 'hrv', ['lastNightAvg']], ['Stress', 'stress', ['avgStressLevel', 'averageStressLevel']],
    ['Beredskap', 'trainingReadiness', ['score']], ['VO₂-maks', 'vo2Max', ['vo2MaxPreciseValue', 'vo2MaxValue']],
  ];
  return `<h3>Utvikling i valgt periode</h3><div class="table-wrap health-trend"><table class="stats-table"><thead><tr><th>Dag</th>${columns.map(([name]) => `<th>${name}</th>`).join('')}</tr></thead><tbody>${days.map(d => `<tr><td>${d.date}</td>${columns.map(([,group,keys,divisor]) => {
    let v = GarminView.find(d.data?.[group], keys); if (typeof v === 'number' && divisor) v /= divisor;
    return `<td>${escapeHtml(GarminView.format(v))}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
