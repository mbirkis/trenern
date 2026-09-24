import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function mapHarness() {
  const lines = [];
  const layer = { clearLayers() {}, addLayer() {} };
  const L = {
    polyline(points, options) {
      const line = { points, options, setStyle(style) { Object.assign(this.options, style); },
        on() { return this; }, bindTooltip() { return this; }, addTo() { return this; } };
      lines.push(line);
      return line;
    },
    latLngBounds: () => ({ pad: () => ({}) }),
    circleMarker: () => ({ bindTooltip() { return this; }, addTo() { return this; } }),
  };
  const ctx = vm.createContext({ L, document: { addEventListener() {} },
    window: { matchMedia: () => ({ matches: false }) }, console });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext('map = { invalidateSize() {}, setView() {} }; overviewLayer = routeLayer = markerLayer = { clearLayers() {} }; updateLegend = () => {}; fitMap = () => {};', ctx);
  return { ctx, lines };
}

test('all-routes overview renders opaque colored lines with a wider dark outline', () => {
  const { ctx, lines } = mapHarness();
  vm.runInContext(`routes = [{ id:'a', type:'running', name:'Run', start:'2026-09-24T10:00:00Z', points:[[59,10],[59.01,10.01]] }]; drawOverview()`, ctx);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].options.interactive, false);
  assert.ok(lines[0].options.weight > lines[1].options.weight);
  assert.ok(lines[1].options.opacity >= .9);
  assert.ok(lines[1].options.weight >= 4);
});

test('selected activity retains a continuous contrasting outline under zone segments', () => {
  const { ctx, lines } = mapHarness();
  vm.runInContext(`drawRoute({ track: [{lat:59, lon:10, hr:100}, {lat:59.01,lon:10.01,hr:120}, {lat:59.02,lon:10.02,hr:170}], hrZones:[{zone:1,maxBpm:110},{zone:2,maxBpm:150},{zone:3,maxBpm:200}] })`, ctx);
  assert.ok(lines.length >= 2);
  assert.equal(lines[0].options.interactive, false);
  assert.equal(lines[0].points.length, 3);
  assert.ok(lines[0].options.weight > lines[1].options.weight);
  assert.ok(lines[1].options.weight >= 5);
});
