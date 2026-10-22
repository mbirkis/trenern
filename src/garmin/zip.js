/**
 * Minimal ZIP reader for the Personal API's activity download, which returns
 * the original device file (normally one .fit) inside a ZIP container.
 * Only the stored and deflate methods exist in practice; anything else is
 * reported rather than silently skipped.
 */
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * @param {Buffer} buf
 * @returns {{name: string, data: Buffer}[]}
 */
export function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Tom eller ugyldig ZIP fra Garmin');
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Fant ikke ZIP-katalogen i Garmin-nedlastingen');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('Ødelagt ZIP-katalog fra Garmin');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    // The local header repeats the name/extra lengths, which may differ from
    // the central directory's — always read the data offset from there.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    if (name.endsWith('/')) continue;
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: zlib.inflateRawSync(raw) });
    else throw new Error(`ZIP-komprimering ${method} støttes ikke (${name})`);
  }
  return out;
}
