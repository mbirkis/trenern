/** Tests for Garmin Connect source config management. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We test the manage module functions directly.
// Since config.js loads config.json from disk, we need a controlled test setup.
describe('GarminConnectConfig', () => {
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trenern-test-'));
    process.env.TRENERN_CONFIG = path.join(tmpDir, 'config.json');
    // Write a minimal config with sources
    fs.writeFileSync(process.env.TRENERN_CONFIG, JSON.stringify({
      server: { port: 3005, host: '127.0.0.1' },
      athlete: { birthYear: 1990 },
      ingest: { autoOnStart: false, intervalMinutes: 0 },
      storage: { backend: 'sqlite' },
      sources: [],
    }, null, 2));
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    delete process.env.TRENERN_CONFIG;
  });

  it('registers garminConnect as a known source type', async () => {
    // Dynamic import to get fresh module state
    const mod = await import('../src/sources/index.js');
    const types = mod.registeredSourceTypes();
    assert.ok(types.includes('garminConnect'), 'garminConnect must be a registered type');
  });

  it('redactSource shows connected status without secrets', async () => {
    const manage = await import('../src/sources/manage.js');
    const result = manage.addSource({
      type: 'garminConnect',
      label: 'Min Garmin Konto',
      enabled: true,
    });
    assert.ok(result.source, 'should return a redacted source');
    assert.equal(result.source.type, 'garminConnect');
    assert.equal(result.source.label, 'Min Garmin Konto');
    // No secret fields should leak
    assert.ok(!result.source.tokenFile, 'tokenFile must not be in redacted view');
    assert.ok(!result.source.password, 'password must not be in redacted view');
    // Should indicate whether a token file exists
    assert.equal(typeof result.source.hasToken, 'boolean', 'hasToken must be boolean');
    assert.equal(result.source.hasToken, false, 'no token file for fresh source');
  });

  it('recognizes a stored personal API key without exposing it', async () => {
    const { redactSource } = await import('../src/sources/manage.js');
    const keyDir = path.join(tmpDir, 'garmin-keys');
    fs.mkdirSync(keyDir);
    const source = redactSource({ id: 'test', type: 'garminConnect', tokenFile: keyDir, enabled: false });
    assert.equal(source.hasToken, false, 'no key installed yet');
    fs.writeFileSync(path.join(keyDir, 'api-key'), 'secret-key\n');
    const connected = redactSource({ id: 'test', type: 'garminConnect', tokenFile: keyDir, enabled: false });
    assert.equal(connected.hasToken, true);
    assert.equal(connected.tokenFile, undefined);
    assert.ok(!JSON.stringify(connected).includes('secret-key'), 'the key must never leave the server');
  });

  it('addSource creates a valid source config', async () => {
    const manage = await import('../src/sources/manage.js');
    const result = manage.addSource({
      type: 'garminConnect',
      label: 'Garmin Test',
      enabled: true,
    });
    assert.ok(result.source, 'should create source');
    assert.ok(result.source.id, 'should have an id');
    assert.ok(result.source.id.includes('garmin'), 'id should relate to garmin');
  });

  it('listSourceConfigs includes garminConnect sources', async () => {
    const manage = await import('../src/sources/manage.js');
    const configs = manage.listSourceConfigs();
    const garmin = configs.filter(s => s.type === 'garminConnect');
    assert.ok(garmin.length > 0, 'should list garminConnect sources');
  });

  it('removing a garminConnect source succeeds', async () => {
    const manage = await import('../src/sources/manage.js');
    const configs = manage.listSourceConfigs();
    const garminConfigs = configs.filter(s => s.type === 'garminConnect');
    if (garminConfigs.length > 0) {
      const result = manage.removeSource(garminConfigs[0].id);
      assert.ok(result.removed, 'should remove successfully');
    }
  });
});