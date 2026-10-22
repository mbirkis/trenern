'use strict';

const ZONE_COLORS = ['#8f8f8f', '#45a557', '#f5a623', '#f76b15', '#e5484d'];
const TYPE_LABELS = {
  running: 'Løping', trailrunning: 'Terrengløp', hiking: 'Fjelltur',
  walking: 'Gåtur', cycling: 'Sykkel', skiing: 'Ski', swimming: 'Svømming', strength: 'Styrke', yoga: 'Yoga', other: 'Annet',
};
const TYPE_COLORS = {
  running: '#0072f5', trailrunning: '#8e4ec6', hiking: '#45a557',
  walking: '#f5a623', cycling: '#f76b15', skiing: '#00b8cc', other: '#8f8f8f',
};
const DEFAULT_VIEW = [61.5, 8.5];

const ICON_ZOOM =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="15" y2="15" stroke-linecap="round"/><line x1="7" y1="4.8" x2="7" y2="9.2" stroke-linecap="round"/><line x1="4.8" y1="7" x2="9.2" y2="7" stroke-linecap="round"/></g></svg>';
const ICON_EDIT =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.4 2.6l2 2L6 12l-3 1 1-3z"/><path d="M10 4l2 2"/></g></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 4h11"/><path d="M6 4V2.5h4V4"/><path d="M4 4l.7 9.5h6.6L12 4"/><path d="M6.5 6.5v5M9.5 6.5v5"/></g></svg>';

// Selectable background map services. `server: true` means "use whatever the
// backend resolved in /api/config" (Tracestrack Topo or OSM fallback), and
// `gl: true` means the style is rendered from vector tiles by MapLibre GL.
// Rekkefølgen her er rekkefølgen i nedtrekkslista.
const MAP_PROVIDERS = {
  // Standardvalget: MapLibre GL rendrer OpenTopoMap-stilen i nettleseren, med
  // høydekurver regnet ut lokalt fra terrengdata. Krever WebGL.
  opentopomap: {
    label: 'OpenTopoMap – vektor (høydekurver)',
    gl: true,
    maxZoom: 20,
  },
  'opentopomap-raster': {
    label: 'OpenTopoMap – raster',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Kartstil: &copy; <a href="https://opentopomap.org/">OpenTopoMap</a> ' +
      '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>), ' +
      'data &copy; OpenStreetMap-bidragsytere',
    maxZoom: 17,
  },
  norgeskart: {
    label: 'Norgeskart – topografisk (Kartverket)',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    maxZoom: 20,
  },
  'norgeskart-graatone': {
    label: 'Norgeskart – gråtone (Kartverket)',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
    attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
    maxZoom: 20,
  },
  standard: { label: 'Serverens kartstil (Tracestrack Topo)', server: true },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap-bidragsytere',
    maxZoom: 19,
  },
};
const DEFAULT_MAP_PROVIDER = 'opentopomap';
const MAP_PROVIDER_KEY = 'trenern.mapProvider';
const MAP_MODE_KEY = 'trenern.mapMode';
const SIDEBAR_KEY = 'trenern.sidebarCollapsed';
const DETAIL_WIDTH_KEY = 'trenern.detailWidth';
const MIN_DETAIL_WIDTH = 280;
const MIN_MAP_WIDTH = 260;
let preferredDetailWidth = 380;
let detailResizeFrame = null;

function getMapMode() {
  try { return localStorage.getItem(MAP_MODE_KEY) === '3d' ? '3d' : '2d'; }
  catch (_) { return '2d'; }
}

function setMapMode(mode) {
  try { localStorage.setItem(MAP_MODE_KEY, mode); } catch (_) { /* ignore */ }
}


function getMapProvider() {
  try {
    const v = localStorage.getItem(MAP_PROVIDER_KEY);
    if (v && MAP_PROVIDERS[v]) return v;
  } catch (_) { /* localStorage unavailable */ }
  return DEFAULT_MAP_PROVIDER;
}

function setMapProvider(id) {
  try { localStorage.setItem(MAP_PROVIDER_KEY, id); } catch (_) { /* ignore */ }
}

/* ------------------------------------------------------------------
   Mobil: kart, liste og detaljer deler samme flate og byttes via
   fanelinja nederst. På desktop vises alle tre side ved side.
------------------------------------------------------------------ */
const MOBILE_Q = window.matchMedia('(max-width: 900px)');
const isMobile = () => MOBILE_Q.matches;

// Siste utsnitt kartet ble tilpasset til. Brukes for å re-tilpasse når
// kartet var skjult (mobil) mens ruta ble tegnet.
let lastBounds = null;

/** Tilpass kartet til et utsnitt og husk det. */
function fitMap(bounds) {
  lastBounds = bounds;
  map.fitBounds(bounds);
  fitTerrainMap(bounds);
}

/** Vis én av panelene ('list' | 'map' | 'detail') på mobil. */
function setMobileView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll('#mobile-nav button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === view));
  });
  if (view === 'map' && map) {
    setTimeout(() => {
      map.invalidateSize();
      resizeTerrainMap();
      if (lastBounds) fitMap(lastBounds);
    }, 0);
  }
}

function initMobileNav() {
  document.querySelectorAll('#mobile-nav button').forEach((b) => {
    b.addEventListener('click', () => setMobileView(b.dataset.view));
  });
  setMobileView('list');
  MOBILE_Q.addEventListener('change', () => setTimeout(() => { map.invalidateSize(); resizeTerrainMap(); }, 0));
}

let map, tileLayer, routeLayer, markerLayer, overviewLayer;
let chartHoverMarker = null;
let chartHoverPoint = null;
let activeProvider = null;
let mapChange = 0;
let terrainMap = null;
let terrainActivity = null;
let legendCtl;
let activities = [];
let routes = [];          // [{id,type,name,start,points:[[lat,lon]...]}]
let selectedId = null;
let appConfig = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  map = L.map('map', { zoomControl: true }).setView(DEFAULT_VIEW, 5);
  overviewLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 0);
  window.addEventListener('resize', () => {
    setDetailWidth(preferredDetailWidth);
    map.invalidateSize();
    resizeTerrainMap();
  });
  // Vektorlaget måler seg selv i en animasjonsramme, som ikke kjører når
  // kartet er skjult (mobilfanen står på listen). Sett størrelsen med én
  // gang i stedet, ellers blir GL-lerretet hengende igjen i standard-
  // størrelsen når man bytter til kartfanen.
  map.on('resize', resizeGlLayer);

  document.getElementById('sync-btn').addEventListener('click', sync);
  initMobileNav();
  initDetailResize();
  document.getElementById('type-filter').addEventListener('change', onFilterChange);
  document.getElementById('activity-search').addEventListener('input', onSearchChange);
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch (_) {}
  setSidebarCollapsed(collapsed);
  document.getElementById('sidebar-collapse').addEventListener('click', () => setSidebarCollapsed(true));
  document.getElementById('sidebar-expand').addEventListener('click', () => setSidebarCollapsed(false));
  document.getElementById('place-tag-status').addEventListener('click', async (event) => {
    if (event.target.id !== 'retry-place-tags') return;
    try {
      await fetchJSON('/api/place-tags/retry', { method: 'POST' });
      document.getElementById('place-tag-status').textContent = 'Prøver å hente stedsnavn …';
    } catch (_) {
      document.getElementById('place-tag-status').textContent = 'Kunne ikke starte nytt forsøk.';
    }
  });
  initSettingsModal();

  try {
    appConfig = await fetchJSON('/api/config');
  } catch (_) { /* non-fatal */ }
  await applyTileLayer();
  addLegend();

  await refresh();
  pollIngest();
  pollPlaceTags();
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  document.getElementById('sidebar-expand').hidden = !collapsed;
  try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch (_) {}
  setDetailWidth(preferredDetailWidth);
  setTimeout(() => { map.invalidateSize(); resizeTerrainMap(); }, 0);
}

function clampDetailWidth(requested, mainWidth, sidebarWidth, handleWidth) {
  const max = Math.max(MIN_DETAIL_WIDTH,
    Math.floor(mainWidth - sidebarWidth - handleWidth - MIN_MAP_WIDTH));
  const value = Number.isFinite(requested) ? requested : 380;
  return { width: Math.min(max, Math.max(MIN_DETAIL_WIDTH, Math.round(value))), max };
}

function setDetailWidth(requested, remember = false) {
  const main = document.querySelector('main');
  const handle = document.getElementById('detail-resize-handle');
  const sidebar = document.getElementById('sidebar');
  const { width, max } = clampDetailWidth(
    requested, main.clientWidth, sidebar.getBoundingClientRect().width, handle.offsetWidth
  );
  main.style.setProperty('--detail-width', `${width}px`);
  handle.setAttribute('aria-valuemax', String(max));
  handle.setAttribute('aria-valuenow', String(width));
  handle.setAttribute('aria-valuetext', `${width} piksler`);
  if (remember) {
    preferredDetailWidth = width;
    try { localStorage.setItem(DETAIL_WIDTH_KEY, String(width)); } catch (_) {}
  }
  if (!detailResizeFrame) detailResizeFrame = requestAnimationFrame(() => {
    detailResizeFrame = null;
    map.invalidateSize({ pan: false });
    resizeTerrainMap();
  });
  return width;
}

function initDetailResize() {
  const handle = document.getElementById('detail-resize-handle');
  let saved;
  try { saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY)); } catch (_) {}
  if (Number.isFinite(saved) && saved >= MIN_DETAIL_WIDTH) preferredDetailWidth = saved;
  setDetailWidth(preferredDetailWidth);
  let dragging = null;
  handle.addEventListener('pointerdown', (event) => {
    if (isMobile() || event.button !== 0) return;
    dragging = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('detail-resizing');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (dragging !== event.pointerId) return;
    const main = document.querySelector('main');
    setDetailWidth(main.getBoundingClientRect().right - event.clientX - handle.offsetWidth / 2);
  });
  const endDrag = (event) => {
    if (dragging !== event.pointerId) return;
    dragging = null;
    document.body.classList.remove('detail-resizing');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel') setDetailWidth(preferredDetailWidth);
    else setDetailWidth(Number.parseFloat(document.querySelector('main').style.getPropertyValue('--detail-width')), true);
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('keydown', (event) => {
    const current = Number(handle.getAttribute('aria-valuenow'));
    const maximum = Number(handle.getAttribute('aria-valuemax'));
    const next = event.key === 'ArrowLeft' ? current + 24
      : event.key === 'ArrowRight' ? current - 24
      : event.key === 'Home' ? MIN_DETAIL_WIDTH
      : event.key === 'End' ? maximum : null;
    if (next == null) return;
    event.preventDefault();
    setDetailWidth(next, true);
  });
}

/* ------------------------------------------------------------------
   Vektorkart (OpenTopoMap)

   MapLibre GL og OpenTopoMap-stilen lastes først når brukeren faktisk
   velger vektorkartet – biblioteket er ~1 MB, og de fleste bakgrunns-
   kartene er vanlige rasterfliser. Selve GL-lerretet legges inn som et
   Leaflet-lag (maplibre-gl-leaflet), slik at ruter og markører tegnes
   av Leaflet som før.
------------------------------------------------------------------ */
const OTM_VECTOR_TILES = 'https://opentopomap.org/otm/{z}/{x}/{y}.pbf';
const OTM_SPRITE = 'https://opentopomap.org/vector/otm_sprite';
const OTM_GLYPHS = 'https://fonts.undpgeohub.org/fonts/{fontstack}/{range}.pbf';
const OTM_DEM_TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';

let maplibreReady = null;

function loadAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement(tag), attrs);
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`kunne ikke laste ${attrs.src || attrs.href}`));
    document.head.appendChild(el);
  });
}

/** Last MapLibre GL + Leaflet-brua + OpenTopoMap-stilen (én gang). */
function ensureMapLibre() {
  if (!maplibreReady) {
    maplibreReady = (async () => {
      await loadAsset('link', { rel: 'stylesheet', href: '/vendor/maplibre/maplibre-gl.css' });
      await loadAsset('script', { src: '/vendor/maplibre/maplibre-gl.js' });
      await Promise.all([
        loadAsset('script', { src: '/vendor/maplibre/leaflet-maplibre-gl.js' }),
        loadAsset('script', { src: '/vendor/maplibre/maplibre-contour.js' }),
        loadAsset('script', { src: '/vendor/maplibre/otm-layers.js' }),
      ]);
    })().catch((err) => {
      maplibreReady = null;   // la neste forsøk prøve på nytt
      throw err;
    });
  }
  return maplibreReady;
}

/** Bygg MapLibre-stilen for OpenTopoMap slik opentopomap.org/vector gjør. */
function otmVectorStyle() {
  const dem = new mlcontour.DemSource({
    url: OTM_DEM_TILES,
    encoding: 'terrarium',
    maxzoom: 15,
    worker: true,
    cacheSize: 100,
    timeoutMs: 10000,
  });
  dem.setupMaplibre(maplibregl);
  return {
    version: 8,
    glyphs: OTM_GLYPHS,
    sprite: OTM_SPRITE,
    sources: {
      'opentopomap-vector': {
        type: 'vector',
        lineMetrics: true,
        tiles: [OTM_VECTOR_TILES],
        maxzoom: 14,
        attribution:
          'Kartstil: &copy; <a href="https://opentopomap.org/">OpenTopoMap</a> ' +
          '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>), ' +
          'data &copy; OpenStreetMap-bidragsytere',
      },
      dem: {
        type: 'raster-dem',
        encoding: 'terrarium',
        tiles: [dem.sharedDemProtocolUrl],
        maxzoom: 15,
        tileSize: 512,
        attribution: 'Terreng: &copy; <a href="https://mapterhorn.com/">mapterhorn</a>',
      },
      'contour-source': {
        type: 'vector',
        tiles: [
          dem.contourProtocolUrl({
            multiplier: 1,
            thresholds: {     // zoomnivå: [mindre kurve, hovedkurve] i meter
              10: [50, 1000], 11: [20, 500], 12: [10, 100],
              13: [10, 100], 14: [10, 100], 15: [10, 50],
            },
            contourLayer: 'contours',
            elevationKey: 'ele',
            levelKey: 'level',
            extent: 4096,
            buffer: 1,
          }),
        ],
        maxzoom: 15,
      },
    },
    // Stilen fra opentopomap.org har et skjult rasterlag på toppen; det
    // trenger vi ikke her (rasterversjonen er sitt eget kartvalg).
    layers: window.OTM_LAYERS.filter((l) => l.source !== 'opentopomap-raster'),
  };
}

/** Gi GL-lerretet samme størrelse som Leaflet-kartet (+ overtegning). */
function resizeGlLayer() {
  if (!tileLayer || !tileLayer.getMaplibreMap) return;
  const size = tileLayer.getSize();
  const el = tileLayer.getContainer();
  el.style.width = `${size.x}px`;
  el.style.height = `${size.y}px`;
  tileLayer.getMaplibreMap().resize();
}

/** Fjern gjeldende bakgrunnskart. */
function removeBaseLayer() {
  if (!tileLayer) return;
  // maplibre-gl-leaflet melder inn attribusjonen sin manuelt, i tillegg til
  // Leaflets eget oppslag, så den blir ikke ryddet bort av seg selv.
  if (tileLayer.getMaplibreMap && map.attributionControl) {
    map.attributionControl.removeAttribution(tileLayer.getAttribution());
  }
  map.removeLayer(tileLayer);
  tileLayer = null;
}

async function applyTileLayer() {
  const change = ++mapChange;
  const mode = getMapMode();
  const id = getMapProvider();
  const p = MAP_PROVIDERS[id] || MAP_PROVIDERS[DEFAULT_MAP_PROVIDER];
  activeProvider = id;

  if (p.gl || mode === '3d') {
    try {
      await ensureMapLibre();
    } catch (err) {
      if (change !== mapChange) return;
      console.warn('MapLibre kunne ikke lastes, faller tilbake til raster', err);
      setMapMode('2d');
      document.getElementById('map-mode').value = '2d';
      document.getElementById('map-mode-status').textContent = '3D-kart kunne ikke lastes. Viser vanlig kart.';
      setMapProvider('opentopomap-raster');
      const sel = document.getElementById('map-provider');
      if (sel) sel.value = 'opentopomap-raster';
      return applyTileLayer();
    }
    if (change !== mapChange) return;   // brukeren rakk å bytte igjen
    if (mode === '3d') {
      try { showTerrainMap(p); }
      catch (err) {
        console.warn('3D-kart kunne ikke opprettes', err);
        setMapMode('2d');
        document.getElementById('map-mode').value = '2d';
        document.getElementById('map-mode-status').textContent = '3D-kart krever WebGL. Viser vanlig kart.';
        return applyTileLayer();
      }
      return;
    }
    hideTerrainMap();
    removeBaseLayer();
    map.setMaxZoom(p.maxZoom || 19);
    tileLayer = L.maplibreGL({ style: otmVectorStyle() }).addTo(map);
    // maplibre-gl-leaflet setter transformen direkte uten å be om ny
    // opptegning, så MapLibre tegner ikke alltid det første bildet når
    // laget legges til på et kart som allerede har et utsnitt. Be om en
    // opptegning hver gang nye data (stil, sprite, fliser) lander.
    const gl = tileLayer.getMaplibreMap();
    gl.on('data', () => gl.triggerRepaint());
    // Kartet kan ha fått sin endelige størrelse før laget ble lagt til.
    setTimeout(() => { map.invalidateSize(); resizeGlLayer(); }, 0);
    return;
  }

  let url, attribution, maxZoom;
  if (p.server) {
    const m = (appConfig && appConfig.map) || {};
    url = m.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    attribution = m.attribution || '&copy; OpenStreetMap-bidragsytere';
    maxZoom = m.maxZoom || 19;
  } else {
    url = p.url;
    attribution = p.attribution;
    maxZoom = p.maxZoom || 19;
  }
  hideTerrainMap();
  removeBaseLayer();
  map.setMaxZoom(maxZoom);
  tileLayer = L.tileLayer(url, { maxZoom, attribution }).addTo(map);
}

/** Standalone MapLibre: GPS and terrain share the same camera and projection. */
function terrainStyle(provider) {
  let style;
  if (provider.gl) style = otmVectorStyle();
  else {
    const config = provider.server ? (appConfig?.map || {}) : provider;
    style = {
      version: 8,
      sources: {
        background: {
          type: 'raster', tileSize: 256,
          tiles: [(config.tileUrl || config.url || MAP_PROVIDERS.osm.url).replace('{s}', 'a')],
          maxzoom: config.maxZoom || 19,
          attribution: config.attribution || MAP_PROVIDERS.osm.attribution,
        },
        dem: {
          type: 'raster-dem', encoding: 'terrarium', tileSize: 512,
          tiles: [OTM_DEM_TILES], maxzoom: 15,
          attribution: 'Terreng: &copy; <a href="https://mapterhorn.com/">mapterhorn</a>',
        },
      },
      layers: [{ id: 'background', type: 'raster', source: 'background' }],
    };
  }
  style.terrain = { source: 'dem', exaggeration: 1 };
  return style;
}

function showTerrainMap(provider) {
  const camera = terrainMap ? {
    center: terrainMap.getCenter(), zoom: terrainMap.getZoom(),
    pitch: terrainMap.getPitch(), bearing: terrainMap.getBearing(),
  } : {
    center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(),
    pitch: 60, bearing: 0,
  };
  hideTerrainMap();
  removeBaseLayer();
  const host = document.getElementById('map');
  const container = document.createElement('div');
  container.id = 'terrain-map';
  host.appendChild(container);
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  terrainMap = new maplibregl.Map({
    container, style: terrainStyle(provider), ...camera,
    maxZoom: provider.maxZoom || 19, maxPitch: 80,
    attributionControl: true,
  });
  host.classList.add('is-3d');
  const gl = terrainMap;
  gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  gl.on('load', () => {
    if (terrainMap !== gl) return;
    gl.addSource('gps', { type: 'geojson', data: terrainRouteData() });
    gl.addSource('chart-hover', { type: 'geojson', data: chartHoverGeoJSON() });
    const lines = ['==', ['geometry-type'], 'LineString'];
    gl.addLayer({ id: 'gps-outline', type: 'line', source: 'gps', filter: lines,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#102030', 'line-width': 10 } });
    gl.addLayer({ id: 'gps-route', type: 'line', source: 'gps', filter: lines,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
    gl.addLayer({ id: 'gps-markers', type: 'circle', source: 'gps',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': 6,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    gl.addLayer({ id: 'chart-hover-marker', type: 'circle', source: 'chart-hover',
      paint: { 'circle-color': '#ffe066', 'circle-radius': 9,
        'circle-stroke-color': '#111', 'circle-stroke-width': 3 } });
    gl.on('click', 'gps-route', (event) => {
      const id = event.features?.[0]?.properties?.activityId;
      if (id && !selectedId) selectActivity(id);
    });
    gl.on('mouseenter', 'gps-route', () => { gl.getCanvas().style.cursor = 'pointer'; });
    gl.on('mouseleave', 'gps-route', () => { gl.getCanvas().style.cursor = ''; });
    gl.on('click', 'gps-markers', (event) => {
      const feature = event.features?.[0];
      if (feature) new maplibregl.Popup().setLngLat(feature.geometry.coordinates)
        .setText(feature.properties.label).addTo(gl);
    });
  });
  gl.on('error', () => {
    if (terrainMap === gl) document.getElementById('map-mode-status').textContent =
      'Noen kart- eller terrengdata kunne ikke lastes. Sjekk nettforbindelsen eller velg et annet bakgrunnskart.';
  });
  resizeTerrainMap();
  if (lastBounds) fitTerrainMap(lastBounds);
}

function hideTerrainMap() {
  if (terrainMap) {
    // Keep the camera location when returning to the flat map.
    const center = terrainMap.getCenter();
    map.setView([center.lat, center.lng], terrainMap.getZoom());
    terrainMap.remove();
    terrainMap = null;
  }
  document.getElementById('terrain-map')?.remove();
  document.getElementById('map').classList.remove('is-3d');
  map.invalidateSize();
}

function resizeTerrainMap() { terrainMap?.resize(); }

function fitTerrainMap(bounds) {
  if (!terrainMap) return;
  terrainMap.resize();
  terrainMap.fitBounds([
    [bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()],
  ], { padding: 45, duration: 0, maxZoom: 16 });
}

function resetTerrainView() {
  if (terrainMap) terrainMap.jumpTo({ center: [DEFAULT_VIEW[1], DEFAULT_VIEW[0]], zoom: 5 });
}

function terrainRouteData() {
  const features = [];
  const line = (points, color, activityId) => {
    if (points.length >= 2) features.push({ type: 'Feature',
      properties: { color, activityId },
      geometry: { type: 'LineString', coordinates: points.map(([lat, lon]) => [lon, lat]) } });
  };
  if (!terrainActivity) {
    for (const route of routes) {
      if (!routeMatchesFilter(route)) continue;
      const points = (route.points || []).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
      line(points, TYPE_COLORS[route.type] || TYPE_COLORS.other, route.id);
    }
  } else {
    const points = (terrainActivity.track || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const zones = terrainActivity.hrZones || appConfig?.hrZones || [];
    let segment = [], zone = null;
    for (const point of points) {
      const nextZone = zoneOf(point.hr, zones);
      segment.push([point.lat, point.lon]);
      if (segment.length > 1 && nextZone !== zone) {
        line(segment, zone ? ZONE_COLORS[zone - 1] : '#0072f5', terrainActivity.id);
        segment = [[point.lat, point.lon]];
      }
      zone = nextZone;
    }
    line(segment, zone ? ZONE_COLORS[zone - 1] : '#0072f5', terrainActivity.id);
    if (points.length >= 2) {
      for (const [point, label, color] of [
        [points[0], 'Start', '#3fb950'], [points[points.length - 1], 'Slutt', '#e5484d'],
      ]) features.push({ type: 'Feature', properties: { label, color },
        geometry: { type: 'Point', coordinates: [point.lon, point.lat] } });
    }
  }
  return { type: 'FeatureCollection', features };
}

function chartHoverGeoJSON() {
  return { type: 'FeatureCollection', features: chartHoverPoint ? [{
    type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [chartHoverPoint.lon, chartHoverPoint.lat] },
  }] : [] };
}

function syncChartHover3D() {
  terrainMap?.getSource('chart-hover')?.setData(chartHoverGeoJSON());
}

function syncTerrainRoutes() {
  terrainMap?.getSource('gps')?.setData(terrainRouteData());
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function refresh() {
  activities = await fetchJSON('/api/activities');
  renderSummary();
  populateTypeFilter();
  renderList();
  await loadRoutes();
  if (selectedId && activities.some((a) => a.id === selectedId)) {
    selectActivity(selectedId, { focus: false });
  } else {
    clearSelection();
  }
}

function currentFilter() {
  return document.getElementById('type-filter').value;
}

function searchText() {
  return document.getElementById('activity-search').value.trim().toLocaleLowerCase('no');
}

function routeMatchesFilter(route) {
  const a = activities.find((item) => item.id === route.id);
  return a ? matchesFilter(a) : true;
}

function onSearchChange() {
  renderList();
  if (selectedId && !activities.some((a) => a.id === selectedId && matchesFilter(a))) {
    clearSelection();
  } else if (!selectedId) {
    drawOverview();
    renderDetail(null);
  }
}

async function onFilterChange() {
  renderList();
  await loadRoutes();
  const stillValid =
    selectedId && activities.some((a) => a.id === selectedId && matchesFilter(a));
  if (selectedId && !stillValid) {
    clearSelection();
  } else if (!selectedId) {
    drawOverview();
    renderDetail(null);
  } else {
    renderMap();
  }
}

function matchesFilter(a) {
  const f = currentFilter();
  const q = searchText();
  return (!f || a.type === f) && (!q ||
    [a.name, ...(a.placeTags || [])].some((s) => String(s || '').toLocaleLowerCase('no').includes(q)));
}

async function loadRoutes() {
  const f = currentFilter();
  try {
    routes = await fetchJSON('/api/routes' + (f ? `?type=${encodeURIComponent(f)}` : ''));
  } catch (_) {
    routes = [];
  }
}

/** Draw either the all-routes overview or the single selected route. */
function renderMap() {
  map.invalidateSize();
  if (selectedId) return;          // detail draw handled by selectActivity()
  drawOverview();
}

function drawOverview() {
  clearChartHover();
  terrainActivity = null;
  syncTerrainRoutes();
  routeLayer.clearLayers();
  markerLayer.clearLayers();
  overviewLayer.clearLayers();
  updateLegend(false);

  const all = [];
  for (const r of routes) {
    if (!routeMatchesFilter(r)) continue;
    if (!r.points || r.points.length < 2) continue;
    // A dark, non-interactive casing separates the route from busy topo tiles.
    L.polyline(r.points, {
      color: '#102030', weight: 9, opacity: 0.85,
      interactive: false, lineCap: 'round', lineJoin: 'round',
    }).addTo(overviewLayer);
    const line = L.polyline(r.points, {
      color: TYPE_COLORS[r.type] || TYPE_COLORS.other,
      weight: 4.5, opacity: 1,
      lineCap: 'round', lineJoin: 'round',
    });
    line.bindTooltip(`${r.name} · ${fmtDate(r.start)}`, { sticky: true });
    line.on('click', () => selectActivity(r.id));
    line.on('mouseover', () => line.setStyle({ weight: 6 }));
    line.on('mouseout', () => line.setStyle({ weight: 4.5 }));
    line.addTo(overviewLayer);
    all.push(...r.points);
  }
  if (all.length) fitMap(L.latLngBounds(all).pad(0.08));
  else { map.setView(DEFAULT_VIEW, 5); resetTerrainView(); }
}

function clearSelection() {
  selectedId = null;
  if (isMobile()) setMobileView('list');
  renderList();
  renderDetail(null);
  drawOverview();
}

/** Menu-bar summary — current calendar year only. */
function renderSummary() {
  const el = document.getElementById('summary');
  const year = new Date().getFullYear();
  const mine = activities.filter(
    (a) => a.start && new Date(a.start).getFullYear() === year
  );
  if (!mine.length) {
    el.innerHTML = `<span class="sum-year">${year}</span><span>ingen økter i år ennå</span>`;
    return;
  }
  const dist = mine.reduce((s, a) => s + (a.distanceM || 0), 0);
  const move = mine.reduce((s, a) => s + (a.movingTimeSec || 0), 0);
  const gain = mine.reduce((s, a) => s + (a.elevationGainM || 0), 0);
  el.innerHTML = [
    `<span class="sum-year">${year}</span>`,
    `<span><b>${mine.length}</b> økter</span>`,
    `<span><b>${(dist / 1000).toFixed(0)}</b> km</span>`,
    `<span><b>${fmtDuration(move)}</b> i bevegelse</span>`,
    `<span><b>${Math.round(gain)}</b> m stigning</span>`,
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
  const ul = document.getElementById('activity-list');
  const items = activities.filter(matchesFilter);
  document.getElementById('search-count').textContent = searchText()
    ? `${items.length} av ${activities.length} turer` : '';
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
      ${(a.placeTags || []).length ? `<div class="place-tags">${a.placeTags.slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}${a.placeTags.length > 5 ? `<span>+${a.placeTags.length - 5}</span>` : ''}</div>` : ''}
      <div class="li-actions">
        <button class="li-icon" data-act="rename" title="Gi nytt navn" aria-label="Gi nytt navn">${ICON_EDIT}</button>
        <button class="li-icon" data-act="zoom" title="Sentrer kartet på turen" aria-label="Sentrer kartet på turen">${ICON_ZOOM}</button>
        <button class="li-icon danger" data-act="del" title="Slett økta" aria-label="Slett økta">${ICON_TRASH}</button>
      </div>
    </li>`).join('') || '<li class="list-empty">Ingen turer samsvarer med søket.</li>';
  ul.querySelectorAll('li[data-id]').forEach((li) => {
    const id = li.dataset.id;
    li.addEventListener('click', () => {
      if (id === selectedId) clearSelection();
      else selectActivity(id);
    });
    li.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
      e.stopPropagation();
      renameActivity(activities.find((x) => x.id === id) || { id });
    });
    li.querySelector('[data-act="zoom"]').addEventListener('click', (e) => {
      e.stopPropagation();
      zoomToActivity(id);
    });
    li.querySelector('[data-act="del"]').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteActivity(id);
    });
  });
}

/** Fit the map to a single activity's route without opening its detail view. */
async function zoomToActivity(id) {
  if (isMobile()) setMobileView('map');
  let pts = [];
  const r = routes.find((x) => x.id === id);
  if (r && r.points && r.points.length >= 2) {
    pts = r.points;
  } else {
    try {
      const a = await fetchJSON(`/api/activities/${id}`);
      pts = (a.track || [])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map((p) => [p.lat, p.lon]);
    } catch (_) { /* ignore */ }
  }
  if (pts.length >= 2) {
    map.invalidateSize();
    fitMap(L.latLngBounds(pts).pad(0.1));
  }
}

/** Prompt for a custom name; empty input resets to the auto-generated name. */
async function renameActivity(a) {
  const current = a.customName || a.name || '';
  const input = prompt(
    'Nytt navn for aktiviteten (la stå tomt for å tilbakestille):',
    current
  );
  if (input === null) return;
  try {
    const r = await fetch(`/api/activities/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input }),
    });
    if (!r.ok) throw new Error(`${r.status}`);
  } catch (e) {
    alert('Kunne ikke lagre navnet: ' + e.message);
    return;
  }
  await refresh();
}

async function deleteActivity(id) {
  const a = activities.find((x) => x.id === id);
  if (!confirm(`Slette økta «${a ? a.name : id}»? Dette kan ikke angres.`)) return;
  try {
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
  } catch (e) {
    alert('Kunne ikke slette: ' + e.message);
    return;
  }
  if (selectedId === id) selectedId = null;
  await refresh();
}

async function selectActivity(id, { focus = true } = {}) {
  selectedId = id;
  renderList();
  let a;
  try {
    a = await fetchJSON(`/api/activities/${id}`);
  } catch (e) {
    document.getElementById('detail').innerHTML = `<div class="detail-empty">Kunne ikke laste økt</div>`;
    return;
  }
  if (selectedId !== id) return;
  drawRoute(a);
  renderDetail(a);
  if (focus && isMobile()) setMobileView('detail');
}

function drawRoute(a) {
  clearChartHover();
  terrainActivity = a;
  syncTerrainRoutes();
  map.invalidateSize();
  overviewLayer.clearLayers();   // hide all other routes while one is selected
  routeLayer.clearLayers();
  markerLayer.clearLayers();
  updateLegend(true);
  const pts = (a.track || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) {
    map.setView(DEFAULT_VIEW, 5);
    resetTerrainView();
    return;
  }
  const zoneBounds = a.hrZones || (appConfig && appConfig.hrZones) || [];
  // A continuous outline keeps short HR-coloured segments legible over the map.
  L.polyline(pts.map((p) => [p.lat, p.lon]), {
    color: '#102030', weight: 11, opacity: 0.9,
    interactive: false, lineCap: 'round', lineJoin: 'round',
  }).addTo(routeLayer);
  // Build coloured segments by HR zone; fall back to a single accent line.
  let curZone = zoneOf(pts[0].hr, zoneBounds);
  let seg = [[pts[0].lat, pts[0].lon]];
  const flush = (z) => {
    if (seg.length < 2) return;
    L.polyline(seg, {
      color: z ? ZONE_COLORS[z - 1] : '#0072f5',
      weight: 5.5,
      opacity: 1,
      lineCap: 'round', lineJoin: 'round',
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

  fitMap(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.1));
}

function zoneOf(hr, bounds) {
  if (!hr || !bounds || !bounds.length) return null;
  const known = bounds.filter(b => Number.isFinite(b.minBpm) || Number.isFinite(b.maxBpm));
  if (!known.length) return null;
  for (const b of known) if (Number.isFinite(b.maxBpm) && hr < b.maxBpm) return b.zone;
  const lower = known.filter(b => Number.isFinite(b.minBpm) && hr >= b.minBpm);
  return lower.length ? lower[lower.length - 1].zone : null;
}

function renderDetail(a) {
  const el = document.getElementById('detail');
  clearChartHover();
  GarminView.reset();
  if (!a) {
    const n = routes.length;
    el.innerHTML = `<div class="detail-empty">
      ${n ? `Viser <b>${n}</b> tur${n === 1 ? '' : 'er'} på kartet.` : 'Ingen turer å vise.'}<br>
      Velg en økt i listen eller klikk en rute for detaljer.
    </div>`;
    return;
  }
  const pace = a.avgPaceSecPerKm ? fmtPace(a.avgPaceSecPerKm) : '–';
  const avgSpeedMs = a.distanceM > 0 && a.movingTimeSec > 0
    ? a.distanceM / a.movingTimeSec : a.metrics?.avgSpeedMs;
  const samples = a.samples?.length ? a.samples : a.track || [];
  const minSampleHr = samples.reduce((min, p) => Number.isFinite(p.hr) && p.hr > 0
    ? Math.min(min, p.hr) : min, Infinity);
  const minHr = a.metrics?.minHr > 0 ? a.metrics.minHr : Number.isFinite(minSampleHr) ? minSampleHr : null;
  const metrics = [
    ['Distanse', a.distanceM != null ? (a.distanceM / 1000).toFixed(2) : '–', 'km'],
    ['Tempo', pace, '/km'],
    ['Maksfart', a.maxSpeedMs != null ? (a.maxSpeedMs * 3.6).toFixed(1) : '–', 'km/t'],
    ['Snittfart', Number.isFinite(avgSpeedMs) ? (avgSpeedMs * 3.6).toFixed(1) : '–', 'km/t'],
    ['Kalorier', a.calories != null ? Math.round(a.calories) : '–', a.calories != null ? 'kcal' : ''],
    ['Snittpuls', a.avgHr || '–', a.avgHr ? 'bpm' : ''],
    ['Laveste puls', minHr ?? '–', minHr != null ? 'bpm' : ''],
    ['Makspuls', a.maxHr || '–', a.maxHr ? 'bpm' : ''],
    ['Skritt', a.steps != null ? a.steps.toLocaleString('no') : '–', ''],
    ['Tid i bevegelse', a.movingTimeSec != null ? fmtDuration(a.movingTimeSec) : '–', ''],
    ['Totaltid', a.durationSec != null ? fmtDuration(a.durationSec) : '–', ''],
  ];

  const totalZ = (a.hrZones || []).reduce((s, z) => s + (z.seconds || 0), 0);
  let zonesHtml;
  if (totalZ > 0) {
    zonesHtml = (a.hrZones || []).map((z) => {
      const pct = (z.seconds / totalZ) * 100;
      return `<div class="zone-row">
        <span class="lbl">Z${z.zone}</span>
        <div class="zone-bar"><span class="z-${z.zone}" style="width:${pct.toFixed(1)}%"></span></div>
        <span class="val">${fmtDuration(z.seconds)}${z.seconds ? ` · ${pct.toFixed(0)}%` : ''}</span>
      </div>`;
    }).join('');
  } else if (a.avgHr) {
    const zn = zoneOf(a.avgHr, a.hrZones);
    zonesHtml = `<div class="zone-note">
      Kilden har bare snitt-/makspuls for denne økta – ingen puls-tidsserie,
      så tid i sone kan ikke beregnes.${zn ? ` Snittpuls ${a.avgHr} bpm ≈ sone Z${zn}.` : ''}
    </div>`;
  } else {
    zonesHtml = '<div class="detail-empty">Ingen pulsdata</div>';
  }

  const chartDefs = [];
  const addChart = (title, source, field, unit) => {
    const series = source.filter((p) => Number.isFinite(p[field])).map((p) => ({
      value: p[field], t: p.t, lat: p.lat, lon: p.lon,
    }));
    if (series.length <= 3) return '';
    const index = chartDefs.push({ title, unit, series }) - 1;
    return chartBlock(title, series, unit, index);
  };
  const splits = computeSplits(a.track || []);

  el.innerHTML = `
    <button id="back-to-all" class="ghost back-btn">← Alle turer</button>
    <h2 class="detail-title">
      <span>${escapeHtml(a.name)}</span>
      <button id="rename-act" class="li-icon" title="Gi nytt navn" aria-label="Gi nytt navn">${ICON_EDIT}</button>
    </h2>
    <div class="sub">${TYPE_LABELS[a.type] || a.type} · ${fmtDateTime(a.start)} · kilde: ${escapeHtml(a.source)}${a.sourceName ? ' / ' + escapeHtml(a.sourceName) : ''}${a.customName ? ' · egendefinert navn' : ''}</div>
    ${(a.placeTags || []).length ? `<div class="detail-place-tags"><div class="section-title">Steder langs ruten</div><div class="place-tags">${a.placeTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>` : ''}
    <div class="metric-grid">
      ${metrics.map(([k, v, u]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v} <small>${u}</small></div></div>`).join('')}
    </div>

    ${addChart('Høydeprofil', a.track || [], 'ele', 'm')}
    ${addChart('Puls', samples, 'hr', 'bpm')}

    <div class="section-title">Pulssoner · ${a.hrZoneSource === 'garmin' ? 'Garmin' : 'beregnet fra appens makspuls'}</div>
    <div class="zones">${zonesHtml}</div>

    ${splits.length ? '<div class="section-title">Beregnet per kilometer</div>' + splitsBlock(splits) : ''}
    ${Object.entries({cad: ['Kadens', '/min'], speed: ['Fart', 'm/s'], power: ['Effekt', 'W'], temp: ['Temperatur', '°C'], verticalOscillation: ['Vertikal bevegelse', ''], groundContactTime: ['Bakkekontakttid', ''], strideLength: ['Skrittlengde', '']}).map(([key,[title,unit]]) => {
      return addChart(title, samples, key, unit);
    }).join('')}
    ${a.extras?.garmin ? '<div class="section-title">Alle Garmin-målinger</div>' + GarminView.statusHtml(a.extras.garmin.endpointStatus) + GarminView.tree('garminExtras', a.extras.garmin.garminExtras || {}) + GarminView.tree('Alle målepunkter', samples) + GarminView.tree('Måleenheter', a.extras.metricDescriptors) + GarminView.tree('summaryDTO', Object.fromEntries(Object.entries(a.extras.garmin).filter(([k]) => !['garminExtras', 'endpointStatus'].includes(k)))) : ''}
  `;
  el.scrollTop = 0;
  const back = document.getElementById('back-to-all');
  if (back) back.addEventListener('click', clearSelection);
  const rn = document.getElementById('rename-act');
  if (rn) rn.addEventListener('click', () => renameActivity(a));
  bindChartHover(el, chartDefs, a.track || []);
  bindSplitHover(el, splits, a.track || []);
}

function chartFractions(series) {
  const first = series[0]?.t;
  const last = series.at(-1)?.t;
  const timed = Number.isFinite(first) && Number.isFinite(last) && last > first &&
    series.every((p, i) => Number.isFinite(p.t) && (i === 0 || p.t >= series[i - 1].t));
  return {
    timed,
    fractions: series.map((p, i) => timed ? (p.t - first) / (last - first) : i / (series.length - 1)),
  };
}

function fmtGraphTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function chartBlock(title, series, unit, index) {
  const values = series.map((p) => p.value);
  const min = values.reduce((a, b) => Math.min(a, b), Infinity);
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  const { timed, fractions } = chartFractions(series);
  const start = timed ? fmtGraphTime(series[0].t) : '–';
  const middle = timed ? fmtGraphTime((series[0].t + series.at(-1).t) / 2) : 'Tid ikke tilgjengelig';
  const end = timed ? fmtGraphTime(series.at(-1).t) : '–';
  return `<div class="chart" data-chart-index="${index}">
    <div class="caption"><span>${title}</span><span>${Math.round(min)}–${Math.round(max)} ${unit}</span></div>
    ${sparkline(values, fractions)}
    <div class="chart-time-axis" aria-label="Tid fra øktstart"><span>${start}</span><span>${middle}</span><span>${end}</span></div>
    <div class="chart-readout" aria-live="off">Hold over grafen for verdi og sted på kartet</div>
  </div>`;
}

function sparkline(series, fractions = series.map((_, i) => i / (series.length - 1))) {
  const W = 320, H = 90, pad = 4;
  const min = series.reduce((a, b) => Math.min(a, b), Infinity);
  const max = series.reduce((a, b) => Math.max(a, b), -Infinity);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + fractions[i] * (W - 2 * pad);
    const y = H - pad - ((v - min) / span) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${pad},${H - pad} ${pts} ${W - pad},${H - pad}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon points="${area}" fill="#5ab1ff22" />
    <polyline points="${pts}" fill="none" stroke="#5ab1ff" stroke-width="1.5" />
    <line class="chart-cursor" x1="0" x2="0" y1="4" y2="86" />
    <circle class="chart-dot" cx="0" cy="0" r="4" />
  </svg>`;
}

function nearestSeriesIndex(fractions, x) {
  let lo = 0, hi = fractions.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fractions[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(fractions[lo - 1] - x) <= Math.abs(fractions[lo] - x) ? lo - 1 : lo;
}

function chartTrackPoint(track, sample) {
  if (Number.isFinite(sample.lat) && Number.isFinite(sample.lon)) return sample;
  if (!Number.isFinite(sample.t)) return null;
  let closest = null, gap = Infinity;
  for (const point of track) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !Number.isFinite(point.t)) continue;
    const delta = Math.abs(point.t - sample.t);
    if (delta < gap) { closest = point; gap = delta; }
  }
  return closest;
}

function clearChartHover() {
  if (chartHoverMarker && markerLayer) markerLayer.removeLayer(chartHoverMarker);
  chartHoverMarker = null;
  if (chartHoverPoint) {
    chartHoverPoint = null;
    syncChartHover3D();
  }
}

function showChartHover(point) {
  if (!point) { clearChartHover(); return; }
  chartHoverPoint = point;
  if (!chartHoverMarker) {
    chartHoverMarker = L.circleMarker([point.lat, point.lon], {
      radius: 9, color: '#111', weight: 3, fillColor: '#ffe066', fillOpacity: 1,
      interactive: false,
    }).addTo(markerLayer);
  } else {
    chartHoverMarker.setLatLng([point.lat, point.lon]);
  }
  syncChartHover3D();
}

function bindChartHover(detail, chartDefs, track) {
  detail.querySelectorAll('[data-chart-index]').forEach((chart) => {
    const { series, unit } = chartDefs[Number(chart.dataset.chartIndex)];
    const { fractions } = chartFractions(series);
    const svg = chart.querySelector('svg');
    const cursor = chart.querySelector('.chart-cursor');
    const dot = chart.querySelector('.chart-dot');
    const readout = chart.querySelector('.chart-readout');
    const min = series.reduce((v, p) => Math.min(v, p.value), Infinity);
    const max = series.reduce((v, p) => Math.max(v, p.value), -Infinity);
    svg.addEventListener('pointermove', (event) => {
      const bounds = svg.getBoundingClientRect();
      if (!bounds.width) return;
      const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const i = nearestSeriesIndex(fractions, fraction);
      const point = series[i];
      const x = 4 + fractions[i] * 312;
      const y = 86 - ((point.value - min) / (max - min || 1)) * 82;
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      chart.classList.add('is-hovered');
      readout.textContent = `${Number(point.value.toFixed(1))} ${unit}${Number.isFinite(point.t) ? ` · ${fmtGraphTime(point.t)} fra start` : ''}`;
      showChartHover(chartTrackPoint(track, point));
    });
    svg.addEventListener('pointerleave', () => {
      chart.classList.remove('is-hovered');
      readout.textContent = 'Hold over grafen for verdi og sted på kartet';
      clearChartHover();
    });
  });
}

function trackPointAtDistance(track, targetM) {
  const points = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t));
  if (!points.length) return null;
  let covered = 0;
  for (let i = 1; i < points.length; i++) {
    const length = distMeters(points[i - 1], points[i]);
    if (covered + length >= targetM) {
      const share = length ? (targetM - covered) / length : 0;
      return { lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * share,
        lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * share };
    }
    covered += length;
  }
  return points.at(-1);
}

function bindSplitHover(detail, splits, track) {
  detail.querySelectorAll('[data-split-index]').forEach((row) => {
    const split = splits[Number(row.dataset.splitIndex)];
    row.addEventListener('pointerenter', () => showChartHover(trackPointAtDistance(track, split.midDistanceM)));
    row.addEventListener('pointerleave', clearChartHover);
  });
}

function distMeters(a, b) {
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Split a GPS track into fixed-distance segments (default 1 km) and return the
 * time / pace / avg HR for each. Boundary times are linearly interpolated so a
 * split is exactly `intervalM` metres regardless of sample spacing. The final
 * segment may be a partial kilometre.
 */
function computeSplits(track, intervalM = 1000) {
  const pts = (track || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t)
  );
  if (pts.length < 2) return [];

  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + distMeters(pts[i - 1], pts[i]);
  }
  const total = cum[cum.length - 1];
  if (total < 200) return [];

  const timeAtDist = (d) => {
    if (d <= 0) return pts[0].t;
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] >= d) {
        const seg = cum[i] - cum[i - 1] || 1;
        const frac = (d - cum[i - 1]) / seg;
        return pts[i - 1].t + (pts[i].t - pts[i - 1].t) * frac;
      }
    }
    return pts[pts.length - 1].t;
  };

  const splits = [];
  const n = Math.max(1, Math.ceil(total / intervalM));
  for (let k = 0; k < n; k++) {
    const dStart = k * intervalM;
    const dEnd = Math.min((k + 1) * intervalM, total);
    const dist = dEnd - dStart;
    const timeSec = timeAtDist(dEnd) - timeAtDist(dStart);
    if (!(timeSec > 0) || dist < 100) continue;   // drop trailing GPS crumbs
    let hrSum = 0, hrN = 0;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] >= dStart && cum[i] <= dEnd && Number.isFinite(pts[i].hr)) {
        hrSum += pts[i].hr;
        hrN++;
      }
    }
    splits.push({
      index: k + 1,
      midDistanceM: (dStart + dEnd) / 2,
      distanceM: dist,
      timeSec,
      paceSecPerKm: timeSec / (dist / 1000),
      avgHr: hrN ? Math.round(hrSum / hrN) : null,
      partial: dist < intervalM - 1,
    });
  }
  return splits;
}

function splitsBlock(splits) {
  const paces = splits.map((s) => s.paceSecPerKm);
  const min = Math.min(...paces), max = Math.max(...paces);
  const span = max - min || 1;
  const hasHr = splits.some((s) => s.avgHr != null);

  const bars = splits.map((s, i) => {
    const norm = (s.paceSecPerKm - min) / span;   // 0 = raskest, 1 = tregest
    const w = 12 + 88 * norm;
    const hue = 140 - 140 * norm;                  // grønn → rød
    const tag = s.paceSecPerKm === min ? ' split-fast'
      : s.paceSecPerKm === max ? ' split-slow' : '';
    const label = s.partial ? (s.distanceM / 1000).toFixed(2) : String(s.index);
    return `<div class="bar-row" data-split-index="${i}">
      <span class="bar-label${tag}">${label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${w.toFixed(1)}%;background:hsl(${hue.toFixed(0)} 62% 52%)"></span></span>
      <span class="bar-value">${fmtPace(s.paceSecPerKm)}</span>
    </div>`;
  }).join('');

  const rows = splits.map((s, i) => {
    const label = s.partial
      ? `${(s.distanceM / 1000).toFixed(2)} km`
      : `Km ${s.index}`;
    const tag = s.paceSecPerKm === min ? ' split-fast'
      : s.paceSecPerKm === max ? ' split-slow' : '';
    return `<tr data-split-index="${i}">
      <td class="yr${tag}">${label}</td>
      <td>${fmtDuration(s.timeSec)}</td>
      <td>${fmtPace(s.paceSecPerKm)}</td>
      ${hasHr ? `<td>${s.avgHr != null ? s.avgHr : '–'}</td>` : ''}
    </tr>`;
  }).join('');

  return `<div class="section-title">Delt tid – tempo per km</div>
  <div class="chart splits">
    <div class="caption">
      <span>Tempo /km · stolpelengde = relativ treghet</span>
      <span>raskest ${fmtPace(min)} · tregest ${fmtPace(max)}</span>
    </div>
    <div class="bar-chart">${bars}</div>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th>Split</th><th>Tid</th><th>Tempo</th>${hasHr ? '<th>Puls</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
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
    if (s.running) setIngestStatus('ingest kjører …', true);
    else if (s.lastResult) {
      const r = s.lastResult;
      setIngestStatus(`sist synk ${fmtDateTime(r.finishedAt)} · +${r.created} nye${healthSyncSummary(r)}`);
    }
  } catch (_) {}
  setTimeout(pollIngest, 15000);
}

let lastTagCount = 0;
async function pollPlaceTags() {
  try {
    const status = await fetchJSON('/api/place-tags/status');
    const el = document.getElementById('place-tag-status');
    el.hidden = !status.running && !status.error;
    el.innerHTML = status.error && !status.running
      ? 'Stedsnavn kunne ikke hentes. <button id="retry-place-tags" type="button" class="ghost">Prøv igjen</button>'
      : status.running ? 'Henter stedsnavn fra GPS-rutene …' : '';
    if (status.completed !== lastTagCount) {
      lastTagCount = status.completed;
      const latest = await fetchJSON('/api/activities');
      const oldTags = activities.find((a) => a.id === selectedId)?.placeTags || [];
      activities = latest;
      renderList();
      if (!selectedId && searchText()) drawOverview();
      const newTags = activities.find((a) => a.id === selectedId)?.placeTags || [];
      if (selectedId && JSON.stringify(oldTags) !== JSON.stringify(newTags)) {
        const a = await fetchJSON(`/api/activities/${selectedId}`);
        if (selectedId === a.id) renderDetail(a);
      }
    }
  } catch (_) {}
  setTimeout(pollPlaceTags, 10000);
}

/** `busy` markerer pågående synk – da vises status også på små skjermer. */
function setIngestStatus(txt, busy = false) {
  const el = document.getElementById('ingest-status');
  el.textContent = txt;
  el.classList.toggle('is-busy', busy);
}

function addLegend() {
  legendCtl = L.control({ position: 'bottomright' });
  legendCtl.onAdd = () => {
    legendCtl._div = L.DomUtil.create('div', 'map-legend');
    return legendCtl._div;
  };
  legendCtl.addTo(map);
  updateLegend(false);
}

function updateLegend(isDetail) {
  if (!legendCtl || !legendCtl._div) return;
  if (isDetail) {
    legendCtl._div.innerHTML =
      'Rutefarge = pulssone<br>' +
      [1, 2, 3, 4, 5]
        .map((z) => `<i style="background:${ZONE_COLORS[z - 1]}"></i>Z${z}`)
        .join(' ');
  } else {
    const present = [...new Set(routes.map((r) => r.type))];
    const types = present.length ? present : Object.keys(TYPE_COLORS);
    legendCtl._div.innerHTML =
      'Farge = turtype<br>' +
      types
        .map(
          (t) =>
            `<i style="background:${TYPE_COLORS[t] || TYPE_COLORS.other}"></i>${
              TYPE_LABELS[t] || t
            }`
        )
        .join('<br>');
  }
}

// ---- settings modal ----
function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const form = document.getElementById('sm-form');
  const openBtn = document.getElementById('settings-btn');
  const close = () => { modal.hidden = true; };

  initMapProviderSelect();
  const mode = document.getElementById('map-mode');
  mode.value = getMapMode();
  mode.addEventListener('change', () => {
    setMapMode(mode.value);
    document.getElementById('map-mode-status').textContent = '';
    applyTileLayer();
  });

  openBtn.addEventListener('click', async () => {
    modal.hidden = false;
    resetSourceForm();
    await renderSourceList();
  });
  document.getElementById('set-close').addEventListener('click', close);
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

function initMapProviderSelect() {
  const sel = document.getElementById('map-provider');
  if (!sel) return;
  sel.innerHTML = Object.entries(MAP_PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${escapeHtml(p.label)}</option>`)
    .join('');
  sel.value = getMapProvider();
  sel.addEventListener('change', () => {
    setMapProvider(sel.value);
    applyTileLayer();
  });
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
  } else if (s.type === 'garminConnect') {
    form.healthStartDate.value = s.healthStartDate || '';
    form.healthBatchDays.value = s.healthBatchDays || 30;
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
    healthStartDate: g('healthStartDate'),
    healthBatchDays: Number(g('healthBatchDays')) || 30,
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
      : s.type === 'garminConnect'
        ? `Garmin Connect · ${s.hasToken ? 'API-nøkkel lagret' : 'mangler API-nøkkel'}`
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
        testEl.textContent = `+${r.created} nye, ${r.updated} oppdatert${healthSyncSummary(r)}` +
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

function healthSyncSummary(result) {
  const health = (result.sources || []).map(s => s.health).filter(Boolean);
  if (!health.length) return '';
  const days = health.reduce((n,h) => n + h.imported, 0);
  const remaining = health.reduce((n,h) => n + h.remaining, 0);
  const warnings = health.reduce((n,h) => n + h.warnings.length, 0);
  return ` · ${days} helsedager${remaining ? ` · ${remaining} helsedager gjenstår` : ''}${warnings ? ' · noen helsemålinger kunne ikke hentes' : ''}`;
}
