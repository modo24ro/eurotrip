/**
 * core/date-utils.js
 * Date, time, flight time, and schedule conflict calculations
 */

export function fmtDate(isoDate, options = {}) {
  if (!isoDate) return '';
  try {
    const [year, month, day] = isoDate.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const defaultOpts = { weekday: 'short', day: 'numeric', month: 'short' };
    return d.toLocaleDateString('ro-RO', Object.keys(options).length ? options : defaultOpts);
  } catch (_) {
    return isoDate;
  }
}

export function fmtTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.slice(0, 5);
}

export function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '';
  const m = Number(minutes);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`;
}

export function parseDuration(durStr) {
  if (!durStr) return 60;
  const num = parseInt(durStr, 10);
  return isNaN(num) || num <= 0 ? 60 : num;
}

export function getScheduleTimes(loc) {
  if (!loc || !loc.visit_time) return null;
  const timeParts = loc.visit_time.split(':').map(Number);
  if (timeParts.length < 2 || isNaN(timeParts[0]) || isNaN(timeParts[1])) return null;

  const startMinutes = timeParts[0] * 60 + timeParts[1];
  const dur = parseDuration(loc.duration_minutes);
  const endMinutes = startMinutes + dur;

  const formatMins = m => {
    const normalized = m % 1440;
    const h = Math.floor(normalized / 60);
    const mins = normalized % 60;
    return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  return {
    start: formatMins(startMinutes),
    end: formatMins(endMinutes),
    startMinutes,
    endMinutes,
    duration: dur,
  };
}

export function detectScheduleConflicts(locations) {
  const conflicts = new Map();
  if (!locations || locations.length < 2) return conflicts;

  const scheduled = locations
    .filter(loc => loc.enabled !== false && loc.visit_date && loc.visit_time)
    .map(loc => {
      const times = getScheduleTimes(loc);
      return times ? { loc, ...times } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i];
      const b = scheduled[j];

      if (b.startMinutes < a.endMinutes) {
        const overlap = a.endMinutes - b.startMinutes;
        if (!conflicts.has(a.loc.id)) {
          conflicts.set(a.loc.id, { overlapMinutes: overlap, conflictingWith: [] });
        }
        if (!conflicts.has(b.loc.id)) {
          conflicts.set(b.loc.id, { overlapMinutes: overlap, conflictingWith: [] });
        }
        conflicts.get(a.loc.id).conflictingWith.push(b.loc);
        conflicts.get(b.loc.id).conflictingWith.push(a.loc);
        conflicts.get(a.loc.id).overlapMinutes = Math.max(conflicts.get(a.loc.id).overlapMinutes, overlap);
        conflicts.get(b.loc.id).overlapMinutes = Math.max(conflicts.get(b.loc.id).overlapMinutes, overlap);
      }
    }
  }
  return conflicts;
}

export function checkTimeConflict(loc, allLocs = []) {
  if (!loc || !loc.visit_date) return null;
  const dayLocs = allLocs.filter(l => l.visit_date === loc.visit_date && l.enabled !== false);
  const dayConflicts = detectScheduleConflicts(dayLocs);
  return dayConflicts.get(loc.id) || null;
}

export function formatFlightTime(iso, tz) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
    if (tz) opts.timeZone = tz;
    return d.toLocaleTimeString('ro-RO', opts);
  } catch {
    return iso.slice(11, 16) || iso;
  }
}

export function formatFlightDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatFlightDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(0, 16);
  }
}

if (typeof window !== 'undefined') {
  window.fmtDate = fmtDate;
  window.fmtTime = fmtTime;
  window.formatDuration = formatDuration;
  window.parseDuration = parseDuration;
  window.getScheduleTimes = getScheduleTimes;
  window.detectScheduleConflicts = detectScheduleConflicts;
  window.checkTimeConflict = checkTimeConflict;
  window.formatFlightTime = formatFlightTime;
  window.formatFlightDate = formatFlightDate;
  window.formatFlightDateTime = formatFlightDateTime;
}

