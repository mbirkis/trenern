import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH =
  process.env.TRENERN_CONFIG || path.join(ROOT, 'config', 'config.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let config;
try {
  config = readJson(CONFIG_PATH);
} catch (err) {
  console.error(`Kunne ikke lese config fra ${CONFIG_PATH}: ${err.message}`);
  console.error('Kopier config/config.example.json til config/config.json.');
  process.exit(1);
}

// Env overrides for the most common knobs.
if (process.env.PORT) config.server.port = Number(process.env.PORT);
if (process.env.HOST) config.server.host = process.env.HOST;

config.paths = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  activities: path.join(ROOT, 'data', 'activities'),
  cache: path.join(ROOT, 'data', 'cache'),
  public: path.join(ROOT, 'public'),
};

for (const p of [config.paths.data, config.paths.activities, config.paths.cache]) {
  fs.mkdirSync(p, { recursive: true });
}

/** Resolve a path from config relative to project root. */
export function resolvePath(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

/** Effective max heart rate: explicit config, else 220 - age, else 190. */
export function maxHr() {
  const a = config.athlete || {};
  if (a.maxHr) return Number(a.maxHr);
  if (a.birthYear) return 220 - (new Date().getFullYear() - Number(a.birthYear));
  return 190;
}

export function restingHr() {
  return Number((config.athlete && config.athlete.restingHr) || 50);
}

export default config;
