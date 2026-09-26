import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDocument } from '../src/parsers/index.js';
import { rowToSummary, computeStats } from '../src/db/shared.js';
import { healthDates, mergeHealth } from '../src/healthSync.js';
import { createGarminConnectSource } from '../src/sources/garminConnect.js';
const parse = (data) => parseDocument({ _garmin: true, activityId: 900, activityTypeDTO: {typeKey:'running'}, summaryDTO: {startTimeGMT:'2026-09-25T08:00:00.0',distance:10000,duration:3600,movingDuration:3500}, ...data }, {sourceId:'test',ref:'900'})[0];

test('uses authoritative distance/time and maximum speed, preserves zero and missing elevation', () => {
  const a = parse({summaryDTO:{startTimeGMT:'2026-09-25T08:00:00.0',distance:10000,duration:3600,movingDuration:3500,maxSpeed:5.1,elevationGain:85},track:[{lat:59,lon:10,t:0},{lat:59.0001,lon:10,t:10}]});
  assert.equal(a.avgPaceSecPerKm,350); assert.equal(a.maxSpeedMs,5.1);
  assert.equal(a.pauseTimeSec,100); assert.equal(a.elevationLossM,null);
  const stopped = parse({summaryDTO:{startTimeGMT:'2026-09-25T08:00:00.0',distance:100,duration:10,movingDuration:0,maxSpeed:0}});
  assert.equal(stopped.movingTimeSec,0); assert.equal(stopped.avgPaceSecPerKm,null); assert.equal(stopped.maxSpeedMs,0);
});

test('indoor samples retain pulse, power, cadence, speed and vendor-specific fields', () => {
  const a = parse({activityTypeDTO:{typeKey:'strength_training'},samples:[{t:0,hr:120,power:200,cad:80,speed:2,directUnknownMetric:42},{t:20,hr:150}],garminExtras:{hrTimeInZones:[{zoneNumber:2,secsInZone:20,zoneLowBoundary:110}]}});
  assert.equal(a.type,'strength'); assert.equal(a.hasTrack,false); assert.equal(a.samples[0].power,200);
  assert.equal(a.samples[0].cad,80); assert.equal(a.samples[0].directUnknownMetric,42);
  assert.equal(a.hrZoneSource,'garmin'); assert.equal(a.hrZones[0].seconds,20);
  assert.equal(a.hrZones[0].minBpm,110);
  const fallback = parse({samples:[{t:0,hr:120},{t:20,hr:130}]});
  assert.equal(fallback.hrZones.reduce((n,z)=>n+z.seconds,0),20);
});

test('preserves raw Garmin sport metrics, rounds and exercise sets', () => {
  const a = parse({summaryDTO:{startTimeGMT:'2026-09-25T08:00:00.0',distance:0,duration:20,trainingEffect:3.2,anaerobicTrainingEffect:1.1,avgGroundContactTime:230,unknownFutureMetric:42},garminExtras:{splits:{lapDTOs:[{distance:200,duration:20}]},exerciseSets:{exerciseSets:[{repetitions:10}]}}});
  assert.equal(a.metrics.aerobicTrainingEffect,3.2); assert.equal(a.metrics.avgGroundContactTimeMs,230);
  assert.equal(a.extras.garmin.unknownFutureMetric,42); assert.equal(a.extras.garmin.garminExtras.splits.lapDTOs[0].distance,200);
});

test('annual statistics exclude missing values and weight averages by time', () => {
  const s=computeStats([{type:'running',movingTimeSec:100,durationSec:150,avgHr:100,calories:0,hrZones:[{zone:2,seconds:20}]},{type:'running',movingTimeSec:300,durationSec:300,avgHr:150,calories:null}]);
  assert.equal(s.averages.avgHr,137.5); assert.equal(s.totalPauseTimeSec,50);
  assert.equal(s.totalCalories,0); assert.equal(s.coverage.calories,1); assert.equal(s.hrZones[2],20);
});

test('health backfill progresses, recent days refresh and old data survives outages', () => {
  const first=healthDates({today:'2026-09-26',startDate:'2026-09-20',batchDays:2});
  assert.deepEqual(first.dates,['2026-09-26','2026-09-25','2026-09-24','2026-09-23','2026-09-22']);
  assert.equal(first.remaining,2);
  const next=healthDates({today:'2026-09-26',startDate:'2026-09-20',batchDays:2,existing:first.dates});
  assert.deepEqual(next.dates.slice(3),['2026-09-21','2026-09-20']); assert.equal(next.remaining,0);
  assert.deepEqual(mergeHealth({data:{hrv:{lastNightAvg:50}}},{data:{daily:{totalSteps:1}},endpointStatus:{hrv:'error'}}).data,{hrv:{lastNightAvg:50},daily:{totalSteps:1}});
});

test('Garmin cache changes when summary metadata changes and health uses CLI date', async () => {
  const src=createGarminConnectSource({id:'test'});
  let name='First'; src._execPython=async args=>JSON.stringify(args.includes('get-health') ? {date:args.at(-1),data:{daily:{totalSteps:42}}} : [{activityId:1,activityName:name,startTimeLocal:'2026-09-25 10:00:00',distance:0}]);
  const first=(await src.listFiles())[0]; name='Renamed'; const second=(await src.listFiles())[0];
  assert.notEqual(first.modifiedTime,second.modifiedTime); assert.equal(first.startDate,'2026-09-25');
  assert.equal((await src.readHealth('2026-09-25')).data.daily.totalSteps,42);
});

test('existing SQLite database upgrades without losing activities and persists health by source/date', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trenern-db-')); const file=path.join(dir,'test.db');
  process.env.TRENERN_SQLITE_FILE=file;
  const {createSqlite}=await import('../src/db/sqlite.js');
  const db=createSqlite(); await db.init();
  try {
    const a=parse({}); await db.upsert(a);
    await db.upsertHealth({source:'test',date:'2026-09-25',data:{daily:{totalSteps:42}}});
    await db.upsertHealth({source:'other',date:'2026-09-25',data:{daily:{totalSteps:1}}});
    await db.init(); assert.equal((await db.get(a.id)).id,a.id);
    assert.equal((await db.list({full:true}))[0].extras.garmin.activityId,900);
    assert.equal((await db.listHealth({source:'test',from:'2026-09-25',to:'2026-09-25'}))[0].data.daily.totalSteps,42);
    await db.upsertHealth({source:'test',date:'2026-09-25',data:{daily:{totalSteps:43}}});
    assert.equal((await db.listHealth()).length,2); assert.equal((await db.stats()).totalDurationSec,3600);
  } finally { await db.close(); fs.rmSync(dir,{recursive:true,force:true}); delete process.env.TRENERN_SQLITE_FILE; }
});


test('PostgreSQL numeric summaries produce numeric totals and weighted means', () => {
  const a = rowToSummary({type:'running',distance_m:'1000',moving_time_sec:'100',duration_sec:'120',avg_hr:'140',calories:'50'});
  const stats = computeStats([a]);
  assert.equal(stats.totalDistanceM,1000); assert.equal(stats.totalCalories,50); assert.equal(stats.averages.avgHr,140);
});
