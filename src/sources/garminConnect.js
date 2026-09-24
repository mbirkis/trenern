/**
 * Garmin Connect source adapter.
 *
 * Lists activities from Garmin Connect and fetches full detail + GPS track
 * via a Python helper (scripts/garmin_client/). Token/credential management
 * is handled by auth-garmin.mjs and stored in config/keys/ — never exposed
 * through the web UI or API.
 *
 * config: {
 *   id, enabled, label?,
 *   tokenFile: "./config/keys/garmin-{id}.token.json",  // set by manage.js
 * }
 *
 * The Python helper (garmin_client) is called as a subprocess:
 *   python3 -m garmin_client list-activities ...
 *   python3 -m garmin_client get-activity ...
 *
 * For testing, set src._execPython to a mock function that returns fixture JSON.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Resolve the Python runner path. Tries .venv first, then system python3. */
function resolvePython() {
  const venvPython = path.join(ROOT, 'scripts', 'garmin_client', '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
}

/**
 * Build the Garmin Connect source adapter.
 * @param {object} cfg  Source configuration from config.sources[]
 */
export function createGarminConnectSource(cfg) {
  const pythonPath = resolvePython();
  const pythonArgsBase = ['-m', 'garmin_client'];

  /** Execute the Python CLI and parse the JSON result. */
  async function execPython(args) {
    const env = { ...process.env, PYTHONPATH: path.join(ROOT, 'scripts') };
    return new Promise((resolve, reject) => {
      execFile(
        pythonPath,
        [...pythonArgsBase, ...args],
        { env, timeout: 30000 },
        (err, stdout, stderr) => {
          if (err) {
            const msg = stderr?.trim() || err.message;
            reject(new Error(`garmin_client feilet: ${msg}`));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  /** Python CLI token arg, if a token file is configured. */
  function tokenArg() {
    if (!cfg.tokenFile) return [];
    return ['--token', cfg.tokenFile];
  }

  return {
    id: cfg.id,
    type: 'garminConnect',
    // Allow test injection
    _execPython: execPython,

    describe: () => `garminConnect ${cfg.id}${cfg.label ? ` (${cfg.label})` : ''}`,

    /**
     * List activities from Garmin Connect as file-like entries.
     * Each entry uses the Garmin activity ID as `ref` (stable across syncs).
     */
    async listFiles() {
      const stdout = await this._execPython([
        ...tokenArg(),
        'list-activities',
        '--start', '0',
        '--limit', '100',
      ]);
      const activities = JSON.parse(stdout);

      return activities.map((a) => ({
        ref: String(a.activityId),
        name: a.activityName || a.activityType?.typeKey || `Garmin-${a.activityId}`,
        modifiedTime: a.startTime || new Date(a.beginTimestamp).toISOString(),
        size: a.distance || 0,
        // Store extra metadata for the parser to use without re-fetching
        _garminType: a.activityType?.typeKey || 'unknown',
        _hasPolyline: a.hasPolyline !== false,
      }));
    },

    /**
     * Fetch full activity detail incl. GPS track from Garmin Connect.
     * Returns JSON that the garminConnect parser (or genericTrack fallback) can handle.
     */
    async readJson(file) {
      const stdout = await this._execPython([
        ...tokenArg(),
        'get-activity',
        '--activity-id', file.ref,
      ]);
      const detail = JSON.parse(stdout);

      // Add the Garmin marker so the parser knows it's from Garmin.
      // GenericTrack will also work, but the dedicated parser handles
      // edge cases (no-GPS, character encoding).
      detail._garmin = true;
      detail._garminType = file._garminType;
      detail._hasPolyline = file._hasPolyline;

      // Ensure track key exists for non-GPS activities
      if (!detail.track) detail.track = [];

      return detail;
    },
  };
}