import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH =
  process.env.TRENERN_CONFIG || path.join(ROOT, 'config', 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config', 'config.example.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Seed config.json from the example on first run (handy for containers where
// config/ is a fresh mounted volume).
if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(EXAMPLE_PATH)) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log(`opprettet ${CONFIG_PATH} fra config.example.json`);
  } catch (err) {
    console.warn(`kunne ikke opprette config.json: ${err.message}`);
  }
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
  keys: path.join(ROOT, 'config', 'keys'),
  public: path.join(ROOT, 'public'),
};

for (const p of [
  config.paths.data,
  config.paths.activities,
  config.paths.cache,
  config.paths.keys,
]) {
  fs.mkdirSync(p, { recursive: true });
}

/** Resolve a path from config relative to project root. */
export function resolvePath(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

/**
 * Persist the current in-memory config back to config.json (pretty-printed).
 * The derived `paths` field is stripped before writing.
 */
export function saveConfig() {
  const { paths, ...rest } = config;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(rest, null, 2) + '\n');
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
