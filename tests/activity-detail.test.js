import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function detailHarness() {
  const detail = { innerHTML: '', scrollTop: 0, querySelectorAll: () => [] };
  const ctx = vm.createContext({
    document: { addEventListener() {}, getElementById: (id) => id === 'detail' ? detail : null },
    window: { matchMedia: () => ({ matches: false }) },
    GarminView: { reset() {}, statusHtml: () => '', tree: () => '' },
    console,
  });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), ctx);
  return { ctx, detail };
}

test('trip detail shows requested summary and moves elevation and pulse above zones', () => {
  const { ctx, detail } = detailHarness();
  vm.runInContext(`renderDetail({
    id:'one', name:'Tur', source:'test', type:'running', start:'2026-09-01T10:00:00Z',
    distanceM:5000, movingTimeSec:1800, durationSec:1900, avgPaceSecPerKm:360,
    maxSpeedMs:5, calories:300, avgHr:140, maxHr:170, steps:6000, metrics:{ minHr:92 },
    hrZones:[], track:[
      {lat:59,lon:10,t:0,ele:10,hr:100}, {lat:59.001,lon:10,t:30,ele:11,hr:110},
      {lat:59.002,lon:10,t:60,ele:12,hr:120}, {lat:59.003,lon:10,t:90,ele:13,hr:130}
    ]
  })`, ctx);
  for (const label of ['Distanse', 'Tempo', 'Maksfart', 'Snittfart', 'Kalorier',
    'Snittpuls', 'Laveste puls', 'Makspuls', 'Skritt', 'Tid i bevegelse', 'Totaltid']) {
    assert.ok(detail.innerHTML.includes(`<div class="k">${label}</div>`), label);
  }
  assert.ok(detail.innerHTML.includes('10.0 <small>km/t</small>'));
  assert.ok(detail.innerHTML.includes('92 <small>bpm</small>'));
  assert.ok(detail.innerHTML.indexOf('Høydeprofil') < detail.innerHTML.indexOf('Pulssoner'));
  assert.ok(detail.innerHTML.indexOf('Puls</span>') < detail.innerHTML.indexOf('Pulssoner'));
  assert.ok(detail.innerHTML.includes('chart-time-axis'));
  assert.ok(!detail.innerHTML.includes('<div class="k">Kadens</div>'));
});

test('chart timing and GPS lookup follow uneven sample timestamps', () => {
  const { ctx } = detailHarness();
  const result = vm.runInContext(`({
    fractions: chartFractions([{t:0},{t:10},{t:90}]).fractions,
    nearest: nearestSeriesIndex([0, 0.1, 1], 0.12),
    point: chartTrackPoint([{lat:59,lon:10,t:0},{lat:60,lon:11,t:90}], {t:80}),
  })`, ctx);
  assert.deepEqual([...result.fractions], [0, 1 / 9, 1]);
  assert.equal(result.nearest, 1);
  assert.equal(result.point.lat, 60);
  assert.equal(result.point.lon, 11);
});

test('chart hover places and removes a GPS marker', () => {
  const { ctx } = detailHarness();
  const result = vm.runInContext(`(() => {
    const events = [];
    markerLayer = { removeLayer() { events.push('removed'); } };
    L = { circleMarker(coords) { events.push(coords); return {
      addTo() { return this; }, setLatLng(next) { events.push(next); }
    }; } };
    showChartHover({lat:59.9,lon:10.8});
    const feature = chartHoverGeoJSON().features[0];
    showChartHover({lat:60,lon:11});
    clearChartHover();
    return { events, feature, empty: chartHoverGeoJSON().features.length };
  })()`, ctx);
  assert.deepEqual([...result.feature.geometry.coordinates], [10.8, 59.9]);
  assert.deepEqual([...result.events[0]], [59.9, 10.8]);
  assert.deepEqual([...result.events[1]], [60, 11]);
  assert.equal(result.events[2], 'removed');
  assert.equal(result.empty, 0);
});

test('split bar location maps to the middle of its route section', () => {
  const { ctx } = detailHarness();
  const result = vm.runInContext(`(() => {
    const route = [{lat:59,lon:10,t:0},{lat:59.01,lon:10,t:600}];
    const split = computeSplits(route)[0];
    return { middle: split.midDistanceM, point: trackPointAtDistance(route, split.midDistanceM) };
  })()`, ctx);
  assert.ok(result.middle > 400 && result.middle < 600);
  assert.ok(result.point.lat > 59.004 && result.point.lat < 59.006);
});

test('statistics panel width leaves usable space for the map', () => {
  const { ctx } = detailHarness();
  const widths = vm.runInContext(`[
    clampDetailWidth(700, 1200, 300, 10),
    clampDetailWidth(100, 1200, 300, 10),
    clampDetailWidth(500, 1000, 42, 10)
  ]`, ctx);
  assert.equal(widths[0].width, 630);
  assert.equal(widths[1].width, 280);
  assert.equal(widths[2].width, 500);
});
