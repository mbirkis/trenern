/**
 * FIT decoder for the original activity files downloaded from the Personal API.
 *
 * The Personal API has no time-series endpoint: `/activity-service/activity/{id}`
 * returns summaries only, so every GPS track, per-second heart rate and cadence
 * value comes from the device's own FIT file. This decoder reads just enough of
 * the format for that: the file header, definition/data records and the `record`
 * message, plus `session` and `sport` for context.
 *
 * Reference: FIT Protocol (Garmin), base types and record layout.
 */

// Seconds between the UNIX epoch and the FIT epoch (1989-12-31T00:00:00Z).
const FIT_EPOCH_SEC = 631065600;
const SEMICIRCLE = 180 / 2 ** 31;

const MSG_FILE_ID = 0;
const MSG_SPORT = 12;
const MSG_SESSION = 18;
const MSG_RECORD = 20;

// Indexed by the low 5 bits of the base type byte.
const BASE_TYPES = [
  { size: 1, invalid: 0xff, read: (b, o) => b.readUInt8(o) },                               // enum
  { size: 1, invalid: 0x7f, read: (b, o) => b.readInt8(o) },                                // sint8
  { size: 1, invalid: 0xff, read: (b, o) => b.readUInt8(o) },                               // uint8
  { size: 2, invalid: 0x7fff, read: (b, o, le) => (le ? b.readInt16LE(o) : b.readInt16BE(o)) },
  { size: 2, invalid: 0xffff, read: (b, o, le) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)) },
  { size: 4, invalid: 0x7fffffff, read: (b, o, le) => (le ? b.readInt32LE(o) : b.readInt32BE(o)) },
  { size: 4, invalid: 0xffffffff, read: (b, o, le) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o)) },
  { size: 1, invalid: 0x00, string: true, read: (b, o) => b.readUInt8(o) },                 // string
  { size: 4, invalid: null, read: (b, o, le) => (le ? b.readFloatLE(o) : b.readFloatBE(o)) },
  { size: 8, invalid: null, read: (b, o, le) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o)) },
  { size: 1, invalid: 0x00, read: (b, o) => b.readUInt8(o) },                               // uint8z
  { size: 2, invalid: 0x0000, read: (b, o, le) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)) },
  { size: 4, invalid: 0x00000000, read: (b, o, le) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o)) },
  { size: 1, invalid: 0xff, read: (b, o) => b.readUInt8(o) },                               // byte
  { size: 8, invalid: null, read: (b, o, le) => Number(le ? b.readBigInt64LE(o) : b.readBigInt64BE(o)) },
  { size: 8, invalid: null, read: (b, o, le) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)) },
  { size: 8, invalid: null, read: (b, o, le) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)) },
];

/** [name, scale, offset] per field number. Scale/offset follow the FIT profile. */
const RECORD_FIELDS = {
  0: ['lat', 1 / SEMICIRCLE],
  1: ['lon', 1 / SEMICIRCLE],
  2: ['ele', 5, 500],
  3: ['hr'],
  4: ['cad'],
  5: ['distance', 100],
  6: ['speed', 1000],
  7: ['power'],
  13: ['temp'],
  39: ['verticalOscillation', 10],
  41: ['groundContactTime', 10],
  53: ['fractionalCadence', 128],
  73: ['speed', 1000],            // enhanced_speed, same unit as speed
  78: ['ele', 5, 500],            // enhanced_altitude
  253: ['timestamp'],
};

const SESSION_FIELDS = {
  2: ['startTime'],
  5: ['sport'],
  6: ['subSport'],
  7: ['totalElapsedTime', 1000],
  8: ['totalTimerTime', 1000],
  9: ['totalDistance', 100],
  11: ['totalCalories'],
  14: ['avgSpeed', 1000],
  15: ['maxSpeed', 1000],
  16: ['avgHeartRate'],
  17: ['maxHeartRate'],
  21: ['totalAscent'],
  22: ['totalDescent'],
  253: ['timestamp'],
};

const SPORT_FIELDS = { 0: ['sport'], 1: ['subSport'], 3: ['name'] };
const FILE_ID_FIELDS = { 1: ['manufacturer'], 2: ['product'], 4: ['timeCreated'], 3: ['serialNumber'] };

const FIELD_MAPS = {
  [MSG_RECORD]: RECORD_FIELDS,
  [MSG_SESSION]: SESSION_FIELDS,
  [MSG_SPORT]: SPORT_FIELDS,
  [MSG_FILE_ID]: FILE_ID_FIELDS,
};

/** Read one field value, skipping array elements beyond the first. */
function readValue(buf, offset, size, baseTypeByte, littleEndian) {
  const type = BASE_TYPES[baseTypeByte & 0x1f];
  if (!type) return undefined;
  if (type.string) {
    const raw = buf.subarray(offset, offset + size);
    const end = raw.indexOf(0);
    const text = raw.subarray(0, end < 0 ? raw.length : end).toString('utf8');
    return text || undefined;
  }
  if (size < type.size) return undefined;
  const value = type.read(buf, offset, littleEndian);
  if (type.invalid !== null && value === type.invalid) return undefined;
  if (typeof value === 'number' && Number.isNaN(value)) return undefined;
  return value;
}

/**
 * Decode a FIT file.
 * @param {Buffer} buf
 * @returns {{track: object[], session: object|null, sport: object|null, fileId: object|null}}
 */
export function decodeFit(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 14) throw new Error('For kort FIT-fil');
  const headerSize = buf.readUInt8(0);
  if (headerSize < 12 || buf.toString('ascii', 8, 12) !== '.FIT') {
    throw new Error('Ikke en FIT-fil (mangler .FIT-signatur)');
  }
  const dataSize = buf.readUInt32LE(4);
  const end = Math.min(buf.length, headerSize + dataSize);

  const definitions = new Map(); // local message type -> definition
  const records = [];
  let session = null;
  let sport = null;
  let fileId = null;
  let lastTimestamp = null;

  let pos = headerSize;
  while (pos < end) {
    const header = buf.readUInt8(pos++);
    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 0x03 : header & 0x0f;

    if (!compressed && header & 0x40) {
      // Definition message.
      pos += 1; // reserved
      const littleEndian = buf.readUInt8(pos++) === 0;
      const globalNum = littleEndian ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos);
      pos += 2;
      const fieldCount = buf.readUInt8(pos++);
      const fields = [];
      for (let i = 0; i < fieldCount; i++) {
        fields.push({ num: buf.readUInt8(pos), size: buf.readUInt8(pos + 1), base: buf.readUInt8(pos + 2) });
        pos += 3;
      }
      // Developer fields carry no data we use, but their bytes must be skipped.
      let devSize = 0;
      if (header & 0x20) {
        const devCount = buf.readUInt8(pos++);
        for (let i = 0; i < devCount; i++) {
          devSize += buf.readUInt8(pos + 1);
          pos += 3;
        }
      }
      definitions.set(local, { globalNum, littleEndian, fields, devSize });
      continue;
    }

    const def = definitions.get(local);
    if (!def) throw new Error(`FIT-fil refererer til ukjent meldingstype ${local}`);
    const map = FIELD_MAPS[def.globalNum];
    const out = map ? {} : null;

    for (const f of def.fields) {
      if (out) {
        const spec = map[f.num];
        if (spec) {
          const raw = readValue(buf, pos, f.size, f.base, def.littleEndian);
          if (raw !== undefined) {
            const [name, scale, offset] = spec;
            out[name] = typeof raw === 'number' && (scale || offset)
              ? raw / (scale || 1) - (offset || 0)
              : raw;
          }
        }
      }
      pos += f.size;
    }
    pos += def.devSize;

    if (compressed && out && lastTimestamp != null) {
      // Compressed headers carry the low 5 bits of the timestamp only.
      const offset = header & 0x1f;
      const rolled = lastTimestamp + ((offset - (lastTimestamp & 0x1f)) & 0x1f);
      out.timestamp = rolled;
    }
    if (out?.timestamp != null) lastTimestamp = out.timestamp;

    if (def.globalNum === MSG_RECORD) records.push(out);
    else if (def.globalNum === MSG_SESSION) session = session || out;
    else if (def.globalNum === MSG_SPORT) sport = sport || out;
    else if (def.globalNum === MSG_FILE_ID) fileId = fileId || out;
  }

  return { track: records.map(toPoint).filter(Boolean), session, sport, fileId };
}

/** Convert one decoded record message into a Trenern sample point. */
function toPoint(r) {
  const p = {};
  if (r.lat != null && Math.abs(r.lat) <= 90) p.lat = round(r.lat, 7);
  if (r.lon != null && Math.abs(r.lon) <= 180) p.lon = round(r.lon, 7);
  if (r.ele != null) p.ele = round(r.ele, 2);
  if (r.hr != null) p.hr = r.hr;
  if (r.cad != null) p.cad = r.cad + (r.fractionalCadence || 0);
  if (r.speed != null) p.speed = round(r.speed, 3);
  if (r.power != null) p.power = r.power;
  if (r.temp != null) p.temp = r.temp;
  if (r.distance != null) p.distance = round(r.distance, 2);
  if (r.verticalOscillation != null) p.verticalOscillation = round(r.verticalOscillation, 2);
  if (r.groundContactTime != null) p.groundContactTime = round(r.groundContactTime, 1);
  // Milliseconds since the UNIX epoch; the parser turns this into seconds from start.
  if (r.timestamp != null) p.t = (r.timestamp + FIT_EPOCH_SEC) * 1000;
  return Object.keys(p).length ? p : null;
}

const round = (v, digits) => Number(v.toFixed(digits));

/** Pick the activity file out of a downloaded archive and decode it. */
export function decodeActivityFiles(entries) {
  const fit = entries.find((e) => /\.fit$/i.test(e.name));
  if (!fit) {
    throw new Error(`Fant ingen FIT-fil i nedlastingen (${entries.map((e) => e.name).join(', ') || 'tom'})`);
  }
  return { fileName: fit.name, ...decodeFit(fit.data) };
}
