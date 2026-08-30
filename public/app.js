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
  initSourcesModal();

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

// ---- sources modal ----
function initSourcesModal() {
  const modal = document.getElementById('sources-modal');
  const form = document.getElementById('sm-form');
  const openBtn = document.getElementById('sources-btn');
  const close = () => { modal.hidden = true; };

  openBtn.addEventListener('click', async () => {
    modal.hidden = false;
    resetSourceForm();
    await renderSourceList();
  });
  document.getElementById('sm-close').addEventListener('click', close);
  document.getElementById('sm-cancel').addEventListener('click', resetSourceForm);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  form.type.addEventListener('change', syncFormVisibility);
  form.authMethod.addEventListener('change', syncFormVisibility);
  form.addEventListener('submit', onSourceSubmit);
  syncFormVisibility();
}

function syncFormVisibility() {
  const form = document.getElementById('sm-form');
  const type = form.type.value;
  const auth = form.authMethod.value;
  form.querySelectorAll('[data-when]').forEach((el) => {
    el.classList.toggle('hide', el.dataset.when !== type);
  });
  form.querySelectorAll('[data-when-auth]').forEach((el) => {
    el.classList.toggle('hide', el.dataset.whenAuth !== auth);
  });
}

function resetSourceForm() {
  const form = document.getElementById('sm-form');
  form.reset();
  form.editingId.value = '';
  form.recursive.checked = true;
  form.enabled.checked = true;
  document.getElementById('sm-form-title').textContent = 'Legg til kilde';
  document.getElementById('sm-save').textContent = 'Lagre kilde';
  document.getElementById('sm-cancel').hidden = true;
  document.getElementById('sm-sa-status').textContent = '';
  hideFormError();
  syncFormVisibility();
}

function fillSourceForm(s) {
  const form = document.getElementById('sm-form');
  resetSourceForm();
  form.editingId.value = s.id;
  form.type.value = s.type;
  form.label.value = s.label || '';
  form.recursive.checked = s.recursive !== false;
  form.enabled.checked = !!s.enabled;
  form.filePattern.value = s.filePattern || '';
  if (s.type === 'googleDrive') {
    form.folderId.value = s.folderId || '';
    form.authMethod.value = s.authMethod || 'serviceAccount';
    const st = document.getElementById('sm-sa-status');
    if (s.hasServiceAccountKey) {
      st.textContent = `Nøkkel lagret${s.serviceAccountEmail ? ' (' + s.serviceAccountEmail + ')' : ''}. La feltet stå tomt for å beholde.`;
    } else if (s.hasApiKey) {
      st.textContent = 'API-nøkkel lagret. La feltet stå tomt for å beholde.';
    }
  } else if (s.type === 'localFolder') {
    form.path.value = s.path || '';
  }
  document.getElementById('sm-form-title').textContent = `Rediger «${s.label || s.id}»`;
  document.getElementById('sm-save').textContent = 'Lagre endringer';
  document.getElementById('sm-cancel').hidden = false;
  syncFormVisibility();
}

function readSourceForm() {
  const form = document.getElementById('sm-form');
  const g = (n) => (form[n] ? form[n].value.trim() : '');
  return {
    id: form.editingId.value || undefined,
    type: form.type.value,
    label: g('label'),
    enabled: form.enabled.checked,
    recursive: form.recursive.checked,
    filePattern: g('filePattern'),
    folderId: g('folderId'),
    authMethod: form.authMethod.value,
    serviceAccountKey: g('serviceAccountKey'),
    apiKey: g('apiKey'),
    path: g('path'),
  };
}

async function onSourceSubmit(e) {
  e.preventDefault();
  hideFormError();
  const body = readSourceForm();
  const editingId = document.getElementById('sm-form').editingId.value;
  const btn = document.getElementById('sm-save');
  btn.disabled = true;
  try {
    const res = await fetch(
      editingId ? `/api/sources/${editingId}` : '/api/sources',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      showFormError((data.errors || [data.error || 'ukjent feil']).join('\n'));
      return;
    }
    resetSourceForm();
    await renderSourceList();
  } catch (err) {
    showFormError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function renderSourceList() {
  const ul = document.getElementById('sm-list');
  let payload;
  try {
    payload = await fetchJSON('/api/sources');
  } catch (e) {
    ul.innerHTML = `<li class="src-test err">Kunne ikke laste kilder: ${escapeHtml(e.message)}</li>`;
    return;
  }
  const sources = payload.sources || [];
  ul.innerHTML = sources.map((s) => {
    const detail = s.type === 'googleDrive'
      ? `Drive-mappe ${s.folderId || '(mangler ID)'} · ${s.authMethod === 'apiKey' ? 'API-nøkkel' : 'service-konto'}${s.serviceAccountEmail ? ' · ' + escapeHtml(s.serviceAccountEmail) : ''}`
      : `Mappe ${escapeHtml(s.path || '')}`;
    return `<li class="src-item" data-id="${s.id}">
      <div class="top">
        <span class="name">${escapeHtml(s.label || s.id)}</span>
        <span class="tag ${s.enabled ? '' : 'off'}">${s.enabled ? s.type : 'av'}</span>
      </div>
      <div class="meta">${detail}</div>
      <div class="src-test" data-role="test"></div>
      <div class="row-actions">
        <button class="ghost" data-act="test">Test</button>
        <button class="ghost" data-act="sync">Synk denne</button>
        <button class="ghost" data-act="edit">Rediger</button>
        <button class="danger" data-act="del">Slett</button>
      </div>
    </li>`;
  }).join('');

  ul.querySelectorAll('.src-item').forEach((li) => {
    const id = li.dataset.id;
    const src = sources.find((s) => s.id === id);
    const testEl = li.querySelector('[data-role="test"]');
    li.querySelector('[data-act="edit"]').onclick = () => fillSourceForm(src);
    li.querySelector('[data-act="test"]').onclick = async (ev) => {
      ev.target.disabled = true;
      testEl.className = 'src-test';
      testEl.textContent = 'tester …';
      try {
        const r = await fetchJSON(`/api/sources/${id}/test`, { method: 'POST' });
        if (r.ok) {
          testEl.className = 'src-test ok';
          testEl.textContent = `OK — ${r.fileCount} fil(er)${r.sample && r.sample.length ? ': ' + r.sample.join(', ') : ''}`;
        } else {
          testEl.className = 'src-test err';
          testEl.textContent = 'Feil: ' + r.error;
        }
      } catch (e) {
        testEl.className = 'src-test err';
        testEl.textContent = 'Feil: ' + e.message;
      } finally {
        ev.target.disabled = false;
      }
    };
    li.querySelector('[data-act="sync"]').onclick = async (ev) => {
      ev.target.disabled = true;
      testEl.className = 'src-test';
      testEl.textContent = 'synker …';
      try {
        const r = await fetchJSON('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId: id }),
        });
        testEl.className = r.errors && r.errors.length ? 'src-test err' : 'src-test ok';
        testEl.textContent = `+${r.created} nye, ${r.updated} oppdatert` +
          (r.errors && r.errors.length ? ` · ${r.errors.join('; ')}` : '');
        await refresh();
      } catch (e) {
        testEl.className = 'src-test err';
        testEl.textContent = 'Feil: ' + e.message;
      } finally {
        ev.target.disabled = false;
      }
    };
    li.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Slette kilden «${src.label || id}»?`)) return;
      await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      await renderSourceList();
    };
  });
}

function showFormError(msg) {
  const el = document.getElementById('sm-error');
  el.textContent = msg;
  el.hidden = false;
}
function hideFormError() {
  document.getElementById('sm-error').hidden = true;
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
