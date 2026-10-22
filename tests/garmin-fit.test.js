/** Tests for the FIT decoder and ZIP reader used by the Personal API download. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodeFit, decodeActivityFiles } from '../src/garmin/fit.js';
import { unzip } from '../src/garmin/zip.js';

const FIT_EPOCH = 631065600;
const SEMI = 2 ** 31 / 180;

/** Build a FIT file with one record definition and the given data messages. */
function buildFit(messages, { compressedTimestamps = false } = {}) {
  const fields = [
    { num: 253, size: 4, base: 0x86, write: (b, v) => b.writeUInt32LE(v, 0) },   // timestamp
    { num: 0, size: 4, base: 0x85, write: (b, v) => b.writeInt32LE(v, 0) },      // position_lat
    { num: 1, size: 4, base: 0x85, write: (b, v) => b.writeInt32LE(v, 0) },      // position_long
    { num: 2, size: 2, base: 0x84, write: (b, v) => b.writeUInt16LE(v, 0) },     // altitude
    { num: 3, size: 1, base: 0x02, write: (b, v) => b.writeUInt8(v, 0) },        // heart_rate
  ];

  const parts = [];
  const def = Buffer.alloc(6 + fields.length * 3);
  def.writeUInt8(0x40, 0);            // definition message, local type 0
  def.writeUInt8(0, 1);               // reserved
  def.writeUInt8(0, 2);               // little endian
  def.writeUInt16LE(20, 3);           // global message number: record
  def.writeUInt8(fields.length, 5);
  fields.forEach((f, i) => {
    def.writeUInt8(f.num, 6 + i * 3);
    def.writeUInt8(f.size, 7 + i * 3);
    def.writeUInt8(f.base, 8 + i * 3);
  });
  parts.push(def);

  for (const m of messages) {
    const body = Buffer.concat(fields.map((f) => {
      const b = Buffer.alloc(f.size);
      f.write(b, m[f.num]);
      return b;
    }));
    parts.push(Buffer.from([0x00]), body);
  }

  if (compressedTimestamps) {
    // A second definition (local type 1) without the timestamp field, the way
    // devices pair compressed headers with a slimmer message layout.
    const slim = fields.slice(1);
    const def1 = Buffer.alloc(6 + slim.length * 3);
    def1.writeUInt8(0x41, 0);
    def1.writeUInt16LE(20, 3);
    def1.writeUInt8(slim.length, 5);
    slim.forEach((f, i) => {
      def1.writeUInt8(f.num, 6 + i * 3);
      def1.writeUInt8(f.size, 7 + i * 3);
      def1.writeUInt8(f.base, 8 + i * 3);
    });
    parts.push(def1);
    for (const m of compressedTimestamps) {
      const body = Buffer.concat(slim.map((f) => {
        const b = Buffer.alloc(f.size);
        f.write(b, m[f.num]);
        return b;
      }));
      parts.push(Buffer.from([0x80 | (1 << 5) | (m.offset & 0x1f)]), body);
    }
  }

  const data = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt8(12, 0);
  header.writeUInt8(0x20, 1);
  header.writeUInt16LE(2142, 2);
  header.writeUInt32LE(data.length, 4);
  header.write('.FIT', 8, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc(2)]); // trailing CRC placeholder
}

test('decodes GPS, altitude and heart rate from record messages', () => {
  const t0 = 1000000;
  const fit = buildFit([
    { 253: t0, 0: Math.round(59.9139 * SEMI), 1: Math.round(10.7522 * SEMI), 2: (120 + 500) * 5, 3: 140 },
    { 253: t0 + 10, 0: Math.round(59.915 * SEMI), 1: Math.round(10.753 * SEMI), 2: (125 + 500) * 5, 3: 150 },
  ]);
  const { track } = decodeFit(fit);
  assert.equal(track.length, 2);
  assert.ok(Math.abs(track[0].lat - 59.9139) < 1e-5);
  assert.ok(Math.abs(track[0].lon - 10.7522) < 1e-5);
  assert.equal(track[0].ele, 120);
  assert.equal(track[0].hr, 140);
  assert.equal(track[0].t, (t0 + FIT_EPOCH) * 1000);
  assert.equal(track[1].t - track[0].t, 10000);
});

test('drops invalid field values instead of importing sentinel numbers', () => {
  const fit = buildFit([
    { 253: 1000, 0: 0x7fffffff, 1: 0x7fffffff, 2: 0xffff, 3: 0xff },
  ]);
  const { track } = decodeFit(fit);
  assert.equal(track.length, 1);
  assert.equal(track[0].lat, undefined);
  assert.equal(track[0].ele, undefined);
  assert.equal(track[0].hr, undefined);
  assert.equal(track[0].t, (1000 + FIT_EPOCH) * 1000);
});

test('follows compressed timestamp headers', () => {
  const t0 = 1000000;
  const fit = buildFit([{ 253: t0, 0: 0, 1: 0, 2: 2500, 3: 100 }], {
    compressedTimestamps: [{ offset: (t0 + 5) & 0x1f, 0: 10 ** 7, 1: 10 ** 7, 2: 2500, 3: 101 }],
  });
  const { track } = decodeFit(fit);
  assert.equal(track.length, 2);
  assert.equal(track[1].t - track[0].t, 5000);
});

test('rejects files that are not FIT', () => {
  assert.throws(() => decodeFit(Buffer.alloc(40)), /FIT/);
});

test('reads stored and deflated ZIP entries and picks the FIT file', () => {
  const fit = buildFit([{ 253: 1000, 0: 0, 1: 0, 2: 2500, 3: 100 }]);
  const entries = [
    { name: 'notes.txt', data: Buffer.from('hei'), method: 0 },
    { name: '12345.fit', data: fit, method: 8 },
  ];

  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const payload = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, payload);

    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    name.copy(cd, 46);
    central.push(cd);
    offset += local.length + payload.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);

  const zip = Buffer.concat([localBuf, centralBuf, eocd]);
  const files = unzip(zip);
  assert.deepEqual(files.map((f) => f.name), ['notes.txt', '12345.fit']);
  assert.equal(files[0].data.toString(), 'hei');

  const decoded = decodeActivityFiles(files);
  assert.equal(decoded.fileName, '12345.fit');
  assert.equal(decoded.track.length, 1);
  assert.equal(decoded.track[0].hr, 100);
});
