import garminConnect from './garminConnect.js';
import healthAutoExport from './healthAutoExport.js';
import genericTrack from './genericTrack.js';
import { finalizeActivity } from '../model.js';

// Order matters: most specific first. genericTrack is the catch-all fallback.
const PARSERS = [garminConnect, healthAutoExport, genericTrack];

export function listParsers() {
  return PARSERS.map((p) => p.id);
}

/**
 * Parse one raw JSON document into an array of finalized, normalized activities.
 * @param {any} json      Parsed JSON content of a source file.
 * @param {object} ctx     { sourceId, ref }  ref = file name / id for provenance.
 */
export function parseDocument(json, ctx) {
  for (const parser of PARSERS) {
    let matched = false;
    try {
      matched = parser.detect(json, ctx.ref);
    } catch {
      matched = false;
    }
    if (!matched) continue;

    let partials = [];
    try {
      partials = parser.parse(json, ctx) || [];
    } catch (err) {
      console.warn(`  parser ${parser.id} feilet på ${ctx.ref}: ${err.message}`);
      continue;
    }
    const activities = partials
      .map((p) => {
        try {
          return finalizeActivity(p);
        } catch (err) {
          console.warn(`  normalisering feilet (${parser.id}/${ctx.ref}): ${err.message}`);
          return null;
        }
      })
      .filter((a) => a && a.start); // an activity needs at least a start time
    if (activities.length) return activities;
  }
  return [];
}
