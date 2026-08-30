'use strict';

const ZONE_COLORS = ['#6b7a8f', '#3fb950', '#d6b52c', '#e8873b', '#e5484d'];
const TYPE_LABELS = {
  running: 'Løping', trailrunning: 'Terrengløp', hiking: 'Fjelltur',
  walking: 'Gåtur', cycling: 'Sykkel', skiing: 'Ski', other: 'Annet',
};

let map, routeLayer, markerLayer;
let activities = [];
let selectedId = null;
let appConfig = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  map = L.map('map', { zoomControl: true }).setView([61.5, 8.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  addLegend();
  setTimeout(() => map.invalidateSize(), 0);
  window.addEventListener('resize', () => map.invalidateSize());

  document.getElementById('sync-btn').addEventListener('click', sync);
  document.getElementById('type-filter').addEventListener('change', renderList);

  try {
    appConfig = await fetchJSON('/api/config');
  } catch (_) { /* non-fatal */ }

  await refresh();
  pollIngest();
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function refresh() {
  const [acts, stats] = await Promise.all([
    fetchJSON('/api/activities'),
    fetchJSON('/api/stats').catch(() => null),
  ]);
  activities = acts;
  renderSummary(stats);
  populateTypeFilter();
  renderList();
  if (selectedId && activities.some((a) => a.id === selectedId)) {
    selectActivity(selectedId);
  } else if (activities.length) {
    selectActivity(activities[0].id);
  }
}

function renderSummary(stats) {
  const el = document.getElementById('summary');
  if (!stats) { el.textContent = ''; return; }
  el.innerHTML = [
    `<span><b>${stats.count}</b> økter</span>`,
    `<span><b>${(stats.totalDistanceM / 1000).toFixed(0)}</b> km totalt</span>`,
    `<span><b>${fmtDuration(stats.totalMovingTimeSec)}</b> i bevegelse</span>`,
    `<span><b>${stats.totalElevationGainM}</b> m stigning</span>`,
  ].join('');
}

function populateTypeFilter() {
  const sel = document.getElementById('type-filter');
  const cur = sel.value;
  const types = [...new Set(activities.map((a) => a.type))];
  sel.innerHTML = '<option value="">Alle typer</option>' +
    types.map((t) => `<option value="${t}">${TYPE_LABELS[t] || t}</option>`).join('');
  sel.value = cur;
}

function renderList() {
  const filter = document.getElementById('type-filter').value;
  const ul = document.getElementById('activity-list');
  const items = activities.filter((a) => !filter || a.type === filter);
  ul.innerHTML = items.map((a) => `
    <li data-id="${a.id}" class="${a.id === selectedId ? 'active' : ''}">
      <div class="li-title">
        <span class="name">${escapeHtml(a.name)}</span>
        <span class="type">${TYPE_LABELS[a.type] || a.type}</span>
      </div>
      <div class="li-meta">
        <span>${fmtDate(a.start)}</span>
        <span>${(a.distanceM / 1000).toFixed(2)} km</span>
        <span>${fmtDuration(a.movingTimeSec)}</span>
        ${a.avgHr ? `<span>${a.avgHr} bpm</span>` : ''}
      </div>
    </li>`).join('');
  ul.querySelectorAll('li').forEach((li) =>
    li.addEventListener('click', () => selectActivity(li.dataset.id)));
}

async function selectActivity(id) {
  selectedId = id;
  renderList();
  let a;
  try {
    a = await fetchJSON(`/api/activities/${id}`);
  } catch (e) {
    document.getElementById('detail').innerHTML = `<div class="detail-empty">Kunne ikke laste økt</div>`;
    return;
  }
  drawRoute(a);
  renderDetail(a);
}

function drawRoute(a) {
  map.invalidateSize();
  routeLayer.clearLayers();
  markerLayer.clearLayers();
  const pts = (a.track || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) {
    map.setView([61.5, 8.5], 5);
    return;
  }
  const zoneBounds = a.hrZones || (appConfig && appConfig.hrZones) || [];
  // Build coloured segments by HR zone; fall back to a single accent line.
  let curZone = zoneOf(pts[0].hr, zoneBounds);
  let seg = [[pts[0].lat, pts[0].lon]];
  const flush = (z) => {
    if (seg.length < 2) return;
    L.polyline(seg, {
      color: z ? ZONE_COLORS[z - 1] : '#5ab1ff',
      weight: 4,
      opacity: 0.9,
    }).addTo(routeLayer);
  };
  for (let i = 1; i < pts.length; i++) {
    const z = zoneOf(pts[i].hr, zoneBounds);
    seg.push([pts[i].lat, pts[i].lon]);
    if (z !== curZone) {
      flush(curZone);
      seg = [[pts[i].lat, pts[i].lon]];
      curZone = z;
    }
  }
  flush(curZone);

  const start = pts[0], end = pts[pts.length - 1];
  L.circleMarker([start.lat, start.lon], { radius: 6, color: '#3fb950', fillOpacity: 1 })
    .bindTooltip('Start').addTo(markerLayer);
  L.circleMarker([end.lat, end.lon], { radius: 6, color: '#e5484d', fillOpacity: 1 })
    .bindTooltip('Slutt').addTo(markerLayer);

  map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.1));
}

function zoneOf(hr, bounds) {
  if (!hr || !bounds || !bounds.length) return null;
  for (const b of bounds) if (hr < b.maxBpm) return b.zone;
  return 5;
}

function renderDetail(a) {
  const el = document.getElementById('detail');
  const pace = a.avgPaceSecPerKm ? fmtPace(a.avgPaceSecPerKm) : '–';
  const speed = a.maxSpeedMs ? (a.maxSpeedMs * 3.6).toFixed(1) + ' km/t' : '–';
  const metrics = [
    ['Distanse', (a.distanceM / 1000).toFixed(2), 'km'],
    ['Tid', fmtDuration(a.movingTimeSec), ''],
    ['Tempo', pace, '/km'],
    ['Stigning', a.elevationGainM, 'm'],
    ['Snittpuls', a.avgHr || '–', a.avgHr ? 'bpm' : ''],
    ['Makspuls', a.maxHr || '–', a.maxHr ? 'bpm' : ''],
    ['Skritt', a.steps != null ? a.steps.toLocaleString('no') : '–', ''],
    ['Kalorier', a.calories != null ? Math.round(a.calories) : '–', a.calories != null ? 'kcal' : ''],
    ['Kadens', a.avgCadence != null ? Math.round(a.avgCadence) : '–', ''],
    ['Maksfart', speed, ''],
  ];

  const totalZ = (a.hrZones || []).reduce((s, z) => s + (z.seconds || 0), 0);
  const zonesHtml = (a.hrZones || []).map((z) => {
    const pct = totalZ ? (z.seconds / totalZ) * 100 : 0;
    return `<div class="zone-row">
      <span class="lbl">Z${z.zone}</span>
      <div class="zone-bar"><span class="z-${z.zone}" style="width:${pct.toFixed(1)}%"></span></div>
      <span class="val">${fmtDuration(z.seconds)}</span>
    </div>`;
  }).join('');

  const eleSeries = (a.track || []).map((p) => p.ele).filter(Number.isFinite);
  const hrSeries = (a.track || []).map((p) => p.hr).filter(Number.isFinite);
  const cumDist = cumulativeDistanceKm(a.track || []);

  el.innerHTML = `
    <h2>${escapeHtml(a.name)}</h2>
    <div class="sub">${TYPE_LABELS[a.type] || a.type} · ${fmtDateTime(a.start)} · kilde: ${escapeHtml(a.source)}${a.sourceName ? ' / ' + escapeHtml(a.sourceName) : ''}</div>
    <div class="metric-grid">
      ${metrics.map(([k, v, u]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v} <small>${u}</small></div></div>`).join('')}
    </div>

    <div class="section-title">Pulssoner (${a.hrRest || '?'}–${a.hrMax || '?'} bpm)</div>
    <div class="zones">${zonesHtml || '<div class="detail-empty">Ingen pulsdata</div>'}</div>

    ${eleSeries.length > 3 ? chartBlock('Høydeprofil', eleSeries, 'm', cumDist) : ''}
    ${hrSeries.length > 3 ? chartBlock('Puls', hrSeries, 'bpm', cumDist) : ''}
  `;
}

function chartBlock(title, series, unit, xKm) {
  const min = Math.min(...series), max = Math.max(...series);
  return `<div class="chart">
    <div class="caption"><span>${title}</span><span>${Math.round(min)}–${Math.round(max)} ${unit}${xKm ? ' · ' + xKm.toFixed(1) + ' km' : ''}</span></div>
    ${sparkline(series)}
  </div>`;
}

function sparkline(series) {
  const W = 320, H = 90, pad = 4;
  const n = series.length;
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / (n - 1)) * (W - 2 * pad);
    const y = H - pad - ((v - min) / span) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${pad},${H - pad} ${pts} ${W - pad},${H - pad}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon points="${area}" fill="#5ab1ff22" />
    <polyline points="${pts}" fill="none" stroke="#5ab1ff" stroke-width="1.5" />
  </svg>`;
}

function cumulativeDistanceKm(track) {
  let d = 0;
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const pts = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    d += 2 * R * Math.asin(Math.sqrt(s));
  }
  return d / 1000;
}

async function sync() {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = 'Synker …';
  try {
    const res = await fetchJSON('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    setIngestStatus(`+${res.created || 0} nye, ${res.updated || 0} oppdatert${res.errors && res.errors.length ? `, ${res.errors.length} feil` : ''}`);
    await refresh();
  } catch (e) {
    setIngestStatus('synk feilet: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Synk nå';
  }
}

async function pollIngest() {
  try {
    const s = await fetchJSON('/api/ingest/status');
    if (s.running) setIngestStatus('ingest kjører …');
    else if (s.lastResult) {
      const r = s.lastResult;
      setIngestStatus(`sist synk ${fmtDateTime(r.finishedAt)} · +${r.created} nye`);
    }
  } catch (_) {}
  setTimeout(pollIngest, 15000);
}

function setIngestStatus(txt) {
  document.getElementById('ingest-status').textContent = txt;
}

function addLegend() {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = 'Rutefarge = pulssone<br>' +
      [1, 2, 3, 4, 5].map((z) => `<i style="background:${ZONE_COLORS[z - 1]}"></i>Z${z}`).join(' ');
    return div;
  };
  legend.addTo(map);
}

// ---- formatting helpers ----
function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}t ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
function fmtPace(secPerKm) {
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('no', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('no', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
