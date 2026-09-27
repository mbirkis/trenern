import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness() {
  const saved = new Map();
  const ctx = vm.createContext({
    document: { addEventListener() {} },
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    console,
  });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), ctx);
  const run = code => vm.runInContext(code, ctx);
  return { run, ctx };
}

test('map mode defaults to 2D, persists 3D and tolerates unavailable storage', () => {
  const { run } = harness();
  assert.equal(run('getMapMode()'), '2d');
  run("setMapMode('3d')");
  assert.equal(run('getMapMode()'), '3d');
  run("setMapMode('invalid')");
  assert.equal(run('getMapMode()'), '2d');
  run("localStorage.getItem = () => { throw Error('blocked'); }");
  assert.equal(run('getMapMode()'), '2d');
});

test('3D overview uses longitude/latitude coordinates, type colours and activity IDs', () => {
  const { run } = harness();
  run("routes = [{id:'walk',type:'hiking',points:[[61,8],[61.1,8.1]]}, {id:'empty',points:[]}]");
  const data = JSON.parse(run('JSON.stringify(terrainRouteData())'));
  assert.equal(data.features.length, 1);
  assert.deepEqual(data.features[0].geometry.coordinates, [[8,61],[8.1,61.1]]);
  assert.equal(data.features[0].properties.color, '#45a557');
  assert.equal(data.features[0].properties.activityId, 'walk');
});

test('selected 3D route has continuous zone segments and start/end markers; overview clears selection', () => {
  const { run } = harness();
  run(`terrainActivity = {id:'run', hrZones:[{zone:1,maxBpm:110},{zone:2,maxBpm:150},{zone:3,maxBpm:200}],
    track:[{lat:61,lon:8,hr:100},{lat:61.1,lon:8.1,hr:120},{lat:61.2,lon:8.2,hr:170}]}`);
  const data = JSON.parse(run('JSON.stringify(terrainRouteData())'));
  const lines = data.features.filter(f => f.geometry.type === 'LineString');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].geometry.coordinates.at(-1), lines[1].geometry.coordinates[0]);
  assert.deepEqual(lines.map(f => f.properties.color), ['#8f8f8f','#45a557']);
  assert.deepEqual(data.features.filter(f => f.geometry.type === 'Point').map(f => f.properties.label), ['Start','Slutt']);
  run('terrainActivity = {track:[{hr:100}]}');
  assert.equal(run('terrainRouteData().features.length'), 0);
  run('terrainActivity = null');
  assert.equal(run('terrainRouteData().features.length'), 0);
});

test('raster background styles retain provider tiles and include real elevation terrain', () => {
  const { run } = harness();
  for (const provider of ['osm','norgeskart','norgeskart-graatone','opentopomap-raster','standard']) {
    const style = JSON.parse(run(`JSON.stringify(terrainStyle(MAP_PROVIDERS['${provider}']))`));
    assert.equal(style.terrain.source, 'dem');
    assert.equal(style.sources.dem.type, 'raster-dem');
    assert.equal(style.sources.dem.encoding, 'terrarium');
    assert.match(style.sources.dem.tiles[0], /mapterhorn/);
    assert.equal(style.layers[0].source, 'background');
    assert.ok(style.sources.background.tiles[0].startsWith('https://'));
  }
});

test('changing modes while MapLibre loads only applies the newest choice', async () => {
  const { run, ctx } = harness();
  ctx.calls = [];
  run(`let finishLoad;
    ensureMapLibre = () => new Promise(resolve => { finishLoad = resolve; });
    showTerrainMap = () => calls.push('3d');
    hideTerrainMap = () => calls.push('hide');
    removeBaseLayer = () => {};
    map = {setMaxZoom() {}};
    L = {tileLayer: () => ({addTo() { calls.push('2d'); }})};
    setMapProvider('osm'); setMapMode('3d');`);
  const pending = run('applyTileLayer()');
  run("setMapMode('2d')");
  await run('applyTileLayer()');
  run('finishLoad()');
  await pending;
  assert.deepEqual(ctx.calls, ['hide','2d']);
});
