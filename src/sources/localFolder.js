import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePath } from '../config.js';

/**
 * Reads *.json files from a folder on the local filesystem.
 * config: { id, path, recursive?, filePattern? }
 */
export function createLocalFolderSource(cfg) {
  const root = resolvePath(cfg.path);
  const pattern = new RegExp(cfg.filePattern || '\\.json$', 'i');

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`kan ikke lese mappe ${dir}: ${err.message}`);
    }
    const out = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (cfg.recursive) out.push(...(await walk(full)));
      } else if (pattern.test(e.name)) {
        const st = await fs.stat(full);
        out.push({
          ref: path.relative(root, full),
          name: e.name,
          modifiedTime: st.mtime.toISOString(),
          size: st.size,
          _full: full,
        });
      }
    }
    return out;
  }

  return {
    id: cfg.id,
    type: 'localFolder',
    describe: () => `localFolder ${root}`,
    listFiles: () => walk(root),
    async readJson(file) {
      const txt = await fs.readFile(file._full, 'utf8');
      return JSON.parse(txt);
    },
  };
}
