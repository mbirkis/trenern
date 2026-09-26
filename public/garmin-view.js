'use strict';
// Shared, lazy data browser: every Garmin field stays accessible without rendering
// thousands of samples when a page first opens.
window.GarminView = (() => {
  const nodes = new Map(); let next = 0;
  const labels = {
    daily: 'Dagsoversikt', heartRate: 'Døgnpuls', steps: 'Skritt', floors: 'Etasjer',
    sleep: 'Søvn', hrv: 'HRV', stress: 'Stress', bodyBattery: 'Body Battery',
    spo2: 'Oksygenmetning', respiration: 'Respirasjon', intensityMinutes: 'Intensitetsminutter',
    restingHeartRate: 'Hvilepuls', vo2Max: 'VO₂-maks', trainingStatus: 'Treningsstatus og belastning',
    trainingReadiness: 'Treningsberedskap og restitusjon', fitnessAge: 'Kondisjonsalder',
    hrTimeInZones: 'Garmins pulssoner', powerTimeInZones: 'Effektsoner',
    splits: 'Garmins runder', typedSplits: 'Intervaller og svømmedetaljer',
    splitSummaries: 'Rundesammendrag', exerciseSets: 'Styrkesett og repetisjoner',
    weather: 'Vær', configuredHrZones: 'Garmins sonegrenser', summaryDTO: 'Øktsammendrag',
    totalSteps: 'Totale skritt', totalKilocalories: 'Kalorier totalt (kcal)', activeKilocalories: 'Aktive kalorier (kcal)',
    bmrKilocalories: 'Hvilekalorier (kcal)', restingHeartRate: 'Hvilepuls (bpm)',
    averageStressLevel: 'Gjennomsnittlig stress', maxStressLevel: 'Maksimalt stress',
    sleepTimeSeconds: 'Søvntid (sekunder)', deepSleepSeconds: 'Dyp søvn (sekunder)',
    lightSleepSeconds: 'Lett søvn (sekunder)', remSleepSeconds: 'REM-søvn (sekunder)',
    awakeSleepSeconds: 'Våken under søvn (sekunder)', weeklyAvg: 'HRV ukesnitt (ms)',
    lastNightAvg: 'HRV siste natt (ms)', recoveryTime: 'Restitusjonstid',
    moderateIntensityMinutes: 'Moderate intensitetsminutter', vigorousIntensityMinutes: 'Harde intensitetsminutter',
    totalCalories: 'Kalorier totalt', floorsAscended: 'Etasjer opp', floorsDescended: 'Etasjer ned',
    score: 'Score', status: 'Status', seconds: 'Sekunder', distance: 'Distanse (m)',
    duration: 'Varighet (sekunder)', movingDuration: 'Bevegelsestid (sekunder)',
    averageHR: 'Snittpuls (bpm)', maxHR: 'Makspuls (bpm)',
    averageHeartRate: 'Snittpuls (bpm)', maxHeartRate: 'Makspuls (bpm)',
    averagePower: 'Snitteffekt (W)', maxPower: 'Makseffekt (W)',
    weight: 'Vekt', repetitions: 'Repetisjoner', numberOfRepetitions: 'Repetisjoner',
    startTimeGMT: 'Starttid (UTC)', activityName: 'Navn', trainingEffect: 'Aerob treningseffekt',
    anaerobicTrainingEffect: 'Anaerob treningseffekt', activityTrainingLoad: 'Treningsbelastning',
    garminExtras: 'Flere Garmin-målinger',
  };
  const esc = (v) => String(v ?? '–').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = (key) => labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  const format = (v) => typeof v === 'number' ? v.toLocaleString('no', {maximumFractionDigits: 2}) : typeof v === 'boolean' ? (v ? 'Ja' : 'Nei') : v ?? '–';
  function tree(key, value) {
    if (value == null || typeof value !== 'object') return `<div class="garmin-field"><span>${esc(label(key))}</span><b>${esc(format(value))}</b></div>`;
    const id = String(++next); nodes.set(id, value);
    const size = Array.isArray(value) ? `${value.length} målinger` : `${Object.keys(value).length} felt`;
    return `<details class="garmin-data" data-garmin-node="${id}"><summary>${esc(label(key))} <small>${size}</small></summary><div class="garmin-children"></div></details>`;
  }
  function page(details, index = 0) {
    const value = nodes.get(details.dataset.garminNode);
    if (!value) return;
    const entries = Object.entries(value), size = 50;
    const child = details.querySelector('.garmin-children');
    child.innerHTML = entries.slice(index, index + size).map(([k, v]) => tree(Array.isArray(value) ? `Måling ${Number(k) + 1}` : k, v)).join('');
    if (entries.length > size) {
      const nav = document.createElement('div'); nav.className = 'garmin-pages';
      for (const [text, target] of [['← Forrige', index-size], ['Neste →', index+size]]) {
        const button = document.createElement('button'); button.textContent = text;
        button.disabled = target < 0 || target >= entries.length;
        button.addEventListener('click', () => page(details, target)); nav.append(button);
      }
      const count = document.createElement('span'); count.textContent = `${index+1}–${Math.min(entries.length,index+size)} av ${entries.length}`; nav.append(count); child.append(nav);
    }
  }
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches?.('[data-garmin-node]') && d.open && !d.dataset.loaded) { d.dataset.loaded = '1'; page(d); }
  }, true);
  function statusHtml(statuses = {}) {
    const text = { empty: 'Ingen data fra Garmin', unsupported: 'Ikke tilgjengelig', error: 'Henting feilet – prøves igjen ved synk' };
    const missing = Object.entries(statuses).filter(([, s]) => s !== 'ok');
    return missing.length ? `<details class="garmin-data"><summary>Datadekning</summary>${missing.map(([k,s]) => `<div class="garmin-field"><span>${esc(label(k))}</span><span>${esc(text[s] || s)}</span></div>`).join('')}</details>` : '';
  }
  const metricLabels = {
    aerobicTrainingEffect: ['Aerob treningseffekt', ''], anaerobicTrainingEffect: ['Anaerob treningseffekt', ''],
    trainingLoad: ['Treningsbelastning', ''], vo2Max: ['VO₂-maks', 'ml/kg/min'],
    avgStrideLengthCm: ['Skrittlengde', 'cm'], avgVerticalOscillationCm: ['Vertikal bevegelse', 'cm'],
    avgGroundContactTimeMs: ['Bakkekontakttid', 'ms'], avgVerticalRatio: ['Vertikalt forhold', '%'],
    avgGroundContactBalance: ['Bakkekontaktbalanse', '%'], maxPower: ['Makseffekt', 'W'],
    normalizedPower: ['Normalisert effekt', 'W'], avgSpeedMs: ['Snittfart', 'm/s'],
    maxCadence: ['Makskadens', '/min'], minElevationM: ['Laveste høyde', 'm'], maxElevationM: ['Høyeste punkt', 'm'],
    minTempC: ['Laveste temperatur', '°C'], maxTempC: ['Høyeste temperatur', '°C'],
    totalStrokes: ['Svømmetak', ''], poolLengthM: ['Bassenglengde', 'm'], avgSwolf: ['SWOLF', ''],
    lengths: ['Bassenglengder', ''], avgStrokeCadence: ['Takfrekvens', '/min'],
    minHr: ['Laveste puls', 'bpm'], activeCalories: ['Aktive kalorier', 'kcal'], restingCalories: ['Hvilekalorier', 'kcal'],
    trainingEffectLabel: ['Treningseffekt', ''], recoveryTimeMinutes: ['Restitusjonstid', 'min'],
  };
  function metricsHtml(metrics = {}) {
    return Object.entries(metrics).map(([k,v]) => {
      const [name, unit] = metricLabels[k] || [label(k), ''];
      return `<div class="metric"><div class="k">${esc(name)}</div><div class="v">${esc(format(v))} <small>${esc(unit)}</small></div></div>`;
    }).join('');
  }
  function find(value, keys) {
    if (!value || typeof value !== 'object') return null;
    for (const k of keys) if (value[k] != null && typeof value[k] !== 'object') return value[k];
    for (const v of Object.values(value)) { const found = find(v, keys); if (found != null) return found; }
    return null;
  }
  const healthFields = [
    ['Skritt', 'daily', ['totalSteps'], ''], ['Kalorier', 'daily', ['totalKilocalories'], 'kcal'],
    ['Etasjer opp', 'daily', ['floorsAscended'], ''],
    ['Moderate intensitetsminutter', 'daily', ['moderateIntensityMinutes'], 'min'],
    ['Harde intensitetsminutter', 'daily', ['vigorousIntensityMinutes'], 'min'],
    ['Hvilepuls', 'heartRate', ['restingHeartRate'], 'bpm'],
    ['Laveste døgnpuls', 'heartRate', ['minHeartRate'], 'bpm'],
    ['Høyeste døgnpuls', 'heartRate', ['maxHeartRate'], 'bpm'],
    ['Søvntid', 'sleep', ['sleepTimeSeconds'], 't', false, 3600],
    ['Søvnscore', 'sleepScore', ['value'], ''],
    ['Dyp søvn', 'sleep', ['deepSleepSeconds'], 't', false, 3600],
    ['Lett søvn', 'sleep', ['lightSleepSeconds'], 't', false, 3600],
    ['REM-søvn', 'sleep', ['remSleepSeconds'], 't', false, 3600],
    ['Våken under søvn', 'sleep', ['awakeSleepSeconds'], 'min', false, 60],
    ['HRV siste natt', 'hrv', ['lastNightAvg'], 'ms'], ['HRV ukesnitt', 'hrv', ['weeklyAvg'], 'ms'],
    ['Stress', 'stress', ['avgStressLevel', 'averageStressLevel'], ''],
    ['Body Battery ladet', 'bodyBattery', ['charged'], ''], ['Body Battery brukt', 'bodyBattery', ['drained'], ''],
    ['SpO₂', 'spo2', ['averageSpO2', 'avgSpO2'], '%'],
    ['Respirasjon', 'respiration', ['avgWakingRespirationValue'], '/min'],
    ['VO₂-maks', 'vo2Max', ['vo2MaxPreciseValue', 'vo2MaxValue'], 'ml/kg/min'],
    ['Treningsberedskap', 'trainingReadiness', ['score'], ''],
    ['Restitusjonstid', 'trainingReadiness', ['recoveryTime'], 'min'],
  ];
  function healthMetrics(data) {
    data = {...data, sleepScore: data.sleep?.dailySleepDTO?.sleepScores?.overall || data.sleep?.sleepScores?.overall};
    return healthFields.filter(f => !f[4]).map(([name,group,keys,unit,,divisor]) => {
      let v = find(data[group], keys);
      if (typeof v === 'number' && v < 0) v = null;
      if (typeof v === 'number' && divisor) v /= divisor;
      return v == null ? '' : `<div class="metric"><div class="k">${esc(name)}</div><div class="v">${esc(format(v))} <small>${esc(unit)}</small></div></div>`;
    }).join('');
  }
  function reset() { nodes.clear(); }
  return { tree, statusHtml, metricsHtml, healthMetrics, find, reset, esc, format, metricLabels };
})();
