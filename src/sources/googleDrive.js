import fs from 'node:fs';
import { google } from 'googleapis';
import { resolvePath } from '../config.js';

/**
 * Reads *.json files from a Google Drive folder.
 *
 * config: {
 *   id, folderId, recursive?, filePattern?,
 *   auth: {
 *     method: "serviceAccount" | "apiKey",
 *     serviceAccountKeyFile: "./config/gdrive-service-account.json",
 *     apiKey: "..."            // only for public folders
 *   }
 * }
 *
 * Service account setup (recommended for self-hosting):
 *   1. Google Cloud console -> create project -> enable "Google Drive API".
 *   2. Create a Service Account, add a JSON key, save it to the path above.
 *   3. Share the Drive folder with the service account's client_email
 *      (Viewer access is enough).
 */
export function createGoogleDriveSource(cfg) {
  const pattern = new RegExp(cfg.filePattern || '\\.json$', 'i');
  const authCfg = cfg.auth || {};
  let drivePromise = null;

  async function getDrive() {
    if (drivePromise) return drivePromise;
    drivePromise = (async () => {
      if (authCfg.method === 'apiKey' || (!authCfg.method && authCfg.apiKey)) {
        if (!authCfg.apiKey) throw new Error('mangler auth.apiKey');
        return google.drive({ version: 'v3', auth: authCfg.apiKey });
      }
      // default: service account
      const keyFile = resolvePath(
        authCfg.serviceAccountKeyFile || './config/gdrive-service-account.json'
      );
      if (!fs.existsSync(keyFile)) {
        throw new Error(`mangler service account nøkkelfil: ${keyFile}`);
      }
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
      return google.drive({ version: 'v3', auth: await auth.getClient() });
    })();
    return drivePromise;
  }

  async function listInFolder(drive, folderId) {
    const files = [];
    let pageToken;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      files.push(...(res.data.files || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return files;
  }

  return {
    id: cfg.id,
    type: 'googleDrive',
    describe: () => `googleDrive folder ${cfg.folderId}`,

    async listFiles() {
      const drive = await getDrive();
      if (!cfg.folderId || cfg.folderId.startsWith('PUT_')) {
        throw new Error('folderId er ikke satt i config');
      }
      const out = [];
      const queue = [cfg.folderId];
      const seen = new Set();
      while (queue.length) {
        const folderId = queue.shift();
        if (seen.has(folderId)) continue;
        seen.add(folderId);
        const entries = await listInFolder(drive, folderId);
        for (const e of entries) {
          if (e.mimeType === 'application/vnd.google-apps.folder') {
            if (cfg.recursive) queue.push(e.id);
          } else if (pattern.test(e.name)) {
            out.push({
              ref: e.id,
              name: e.name,
              modifiedTime: e.modifiedTime,
              size: Number(e.size || 0),
            });
          }
        }
      }
      return out;
    },

    async readJson(file) {
      const drive = await getDrive();
      const res = await drive.files.get(
        { fileId: file.ref, alt: 'media', supportsAllDrives: true },
        { responseType: 'text' }
      );
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    },
  };
}
