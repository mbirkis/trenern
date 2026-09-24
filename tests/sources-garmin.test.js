/** Tests for Garmin Connect source adapter. */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Resolve the venv python and fixtures path once
const VENV_PYTHON = path.join(ROOT, 'scripts', 'garmin_client', '.venv', 'bin', 'python');
const FIXTURES_DIR = path.join(ROOT, 'scripts', 'garmin_client', 'tests', 'fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

describe('GarminConnectSource', () => {
  describe('listFiles', () => {
    it('returns a list of file-like entries with ref, name, modifiedTime, size', async () => {
      const { createGarminConnectSource } = await import('../src/sources/garminConnect.js');
      const src = createGarminConnectSource({
        id: 'test-garmin',
        enabled: true,
        label: 'Test Garmin',
      });
      // Mock Python executor to return fixture data directly
      const activities = loadFixture('test_activities.json');
      src._execPython = async () => JSON.stringify(activities);

      const files = await src.listFiles();
      assert.ok(Array.isArray(files), 'listFiles must return an array');
      assert.ok(files.length > 0, 'should return at least one activity');
      for (const f of files) {
        assert.ok(typeof f.ref === 'string', `ref should be string, got ${typeof f.ref}`);
        assert.ok(typeof f.name === 'string', `name should be string, got ${typeof f.name}`);
        assert.ok(f.modifiedTime, 'modifiedTime should exist');
        assert.ok(typeof f.size === 'number', `size should be number, got ${typeof f.size}`);
      }
    });

    it('includes activities without GPS (strength, yoga)', async () => {
      const { createGarminConnectSource } = await import('../src/sources/garminConnect.js');
      const src = createGarminConnectSource({
        id: 'test-garmin',
        enabled: true,
      });
      const activities = loadFixture('test_activities.json');
      src._execPython = async () => JSON.stringify(activities);

      const files = await src.listFiles();
      const names = files.map(f => f.name);
      assert.ok(names.some(n => n.includes('Strength')), 'Strength Training must be present');
      assert.ok(names.some(n => n.includes('Morning')), 'Running must be present');
    });
  });

  describe('readJson', () => {
    it('returns JSON with track for GPS activities', async () => {
      const { createGarminConnectSource } = await import('../src/sources/garminConnect.js');
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._execPython = async (args) => {
        if (args.includes('12345678')) {
          return JSON.stringify(loadFixture('test_activity_detail.json'));
        }
        return '{}';
      };
      const data = await src.readJson({ ref: '12345678', _garminType: 'running', _hasPolyline: true });
      assert.ok(data.track, 'should have track');
      assert.ok(data.track.length > 0, 'track should have points');
      assert.ok(data._garmin, 'should have _garmin marker');
    });

    it('returns JSON without track for non-GPS activities', async () => {
      const { createGarminConnectSource } = await import('../src/sources/garminConnect.js');
      const src = createGarminConnectSource({ id: 'test-garmin', enabled: true });
      src._execPython = async (args) => {
        return JSON.stringify({
          activityId: 12345680,
          activityName: 'Strength Training',
          activityType: { typeKey: 'strength_training' },
          track: [],
        });
      };
      const data = await src.readJson({ ref: '12345680', _garminType: 'strength_training', _hasPolyline: false });
      assert.ok(data.track, 'should have track key');
      assert.equal(data.track.length, 0, 'track should be empty for non-GPS activity');
      assert.ok(data._garmin, 'should have _garmin marker');
    });
  });

  describe('describe', () => {
    it('returns a human-readable description', async () => {
      const { createGarminConnectSource } = await import('../src/sources/garminConnect.js');
      const src = createGarminConnectSource({ id: 'my-garmin', enabled: true, label: 'Min Garmin' });
      assert.ok(typeof src.describe() === 'string');
      assert.ok(src.describe().includes('garminConnect'));
      assert.ok(src.describe().includes('my-garmin'));
    });
  });
});