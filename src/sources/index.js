import { createLocalFolderSource } from './localFolder.js';
import { createGoogleDriveSource } from './googleDrive.js';
import { createGarminConnectSource } from './garminConnect.js';
import config from '../config.js';

const FACTORIES = {
  localFolder: createLocalFolderSource,
  googleDrive: createGoogleDriveSource,
  garminConnect: createGarminConnectSource,
};

export function registeredSourceTypes() {
  return Object.keys(FACTORIES);
}

/** Build source adapter instances from config.sources (enabled ones only). */
export function buildSources({ includeDisabled = false } = {}) {
  const out = [];
  for (const cfg of config.sources || []) {
    if (!cfg.enabled && !includeDisabled) continue;
    const factory = FACTORIES[cfg.type];
    if (!factory) {
      console.warn(`Ukjent kildetype "${cfg.type}" (id=${cfg.id}) — hoppet over`);
      continue;
    }
    try {
      const src = factory(cfg);
      src.enabled = !!cfg.enabled;
      src.config = cfg;
      out.push(src);
    } catch (err) {
      console.warn(`Kunne ikke bygge kilde ${cfg.id}: ${err.message}`);
    }
  }
  return out;
}
