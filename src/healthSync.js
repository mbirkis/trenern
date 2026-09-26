const DAY = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export function healthDates({ today, startDate, existing = [], batchDays = 30, force = false }) {
  const end = Date.parse(`${today}T00:00:00Z`), start = Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('Ugyldig startdato for Garmin-helsedata');
  const known = new Set(existing);
  const recent = [], history = [];
  for (let t = end; t >= start; t -= DAY) {
    const d = isoDay(t);
    if (end - t < 3 * DAY) recent.push(d);
    else if (force || !known.has(d)) history.push(d);
  }
  // Refresh recent days while gradually filling older history, newest first.
  return { dates: [...recent, ...history.slice(0, batchDays)], remaining: Math.max(0, history.length - batchDays) };
}
export function mergeHealth(previous, incoming) {
  const data = { ...previous?.data, ...incoming.data };
  // A transient failure must never erase already imported health data.
  return { ...incoming, data };
}
