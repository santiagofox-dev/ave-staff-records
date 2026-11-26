'use strict';
/* Turns punches into work sessions (entry → exit). Same rules as gpoave.com (checador.js), so the hours the
   site sees offline match what the office sees after the sync. Keep both copies in step. */
const DUP_MIN = 20;          // two punches closer than this = the same tap twice
const MAX_SPAN_MIN = 20 * 60; // longer than this between entry and exit = a missed punch

const toM = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const circ = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };
const nearest = (shifts, m, key) => shifts.reduce((best, s) => (!best || circ(m, s[key]) < circ(m, best[key]) ? s : best), null);
const mins = ts => Math.floor(Date.parse(ts.slice(0, 16) + 'Z') / 60000);
const ymdOf = abs => new Date(abs * 60000).toISOString().slice(0, 10);
const hmOf = abs => new Date(abs * 60000).toISOString().slice(11, 16);
const mod = abs => ((abs % 1440) + 1440) % 1440;

function prepShifts(list) {
  return (list || []).map(s => ({ name: s.name, start: toM(s.start), end: toM(s.end), startT: s.start, endT: s.end })).filter(s => s.start != null && s.end != null);
}

function sessionsOf(times, shifts) {
  const S = [];
  let open = null, lastOut = null;
  const looksLikeExit = m => { if (!shifts.length) return false; const st = nearest(shifts, m, 'start'), en = nearest(shifts, m, 'end'); return circ(m, en.end) <= 90 && circ(m, st.start) > 90; };
  const looksLikeEntry = m => shifts.length && circ(m, nearest(shifts, m, 'start').start) <= 60;
  for (const t of times) {
    if (open) {
      const span = t - open.in;
      if (span < DUP_MIN) continue;
      if (span <= MAX_SPAN_MIN && !(span > 14 * 60 && looksLikeEntry(mod(t)) && !looksLikeExit(mod(t)))) { open.out = t; S.push(open); lastOut = t; open = null; continue; }
      S.push(open); open = null;
    }
    if (lastOut != null && t - lastOut < DUP_MIN) continue;
    if (looksLikeExit(mod(t))) { S.push({ in: null, out: t }); lastOut = t; continue; }
    open = { in: t };
  }
  if (open) S.push(open);
  for (const s of S) {
    s.shift = s.in != null ? nearest(shifts, mod(s.in), 'start') : nearest(shifts, mod(s.out), 'end');
    if (s.in != null) s.day = ymdOf(s.in);
    else { const sh = s.shift; s.day = ymdOf(s.out - (sh && sh.end < sh.start && mod(s.out) < sh.start ? 1440 : 0)); }
  }
  return S;
}

/** Per person and day: entry, exit, hours. For the offline weekly report. */
function workDays(punches, shiftList, fromYmd, toYmd) {
  const shifts = prepShifts(shiftList), byEmp = {};
  for (const p of punches) (byEmp[p.emp] = byEmp[p.emp] || []).push(mins(p.ts));
  const out = {};
  for (const [emp, times] of Object.entries(byEmp)) {
    for (const s of sessionsOf([...new Set(times)].sort((a, b) => a - b), shifts)) {
      if (s.day < fromYmd || s.day > toYmd) continue;
      const d = ((out[emp] = out[emp] || {})[s.day] = out[emp][s.day] || { in: null, out: null, hours: 0, shift: s.shift && s.shift.name, incomplete: false });
      if (s.in != null && (d.inAbs == null || s.in < d.inAbs)) { d.inAbs = s.in; d.in = hmOf(s.in); }
      if (s.out != null) d.out = hmOf(s.out);
      if (s.in != null && s.out != null) d.hours = Math.round((d.hours + (s.out - s.in) / 60) * 100) / 100; else d.incomplete = true;
    }
  }
  return out;
}

/** Who is inside right now (entry without exit in the last 16 h). */
function inside(punches, shiftList, nowAbs) {
  const shifts = prepShifts(shiftList), byEmp = {};
  for (const p of punches) (byEmp[p.emp] = byEmp[p.emp] || []).push(mins(p.ts));
  const out = [];
  for (const [emp, times] of Object.entries(byEmp)) {
    const ses = sessionsOf([...new Set(times)].sort((a, b) => a - b), shifts), last = ses[ses.length - 1];
    if (last && last.in != null && last.out == null && nowAbs - last.in < 16 * 60) out.push({ emp, since: hmOf(last.in), shift: last.shift && last.shift.name });
  }
  return out;
}

module.exports = { sessionsOf, workDays, inside, prepShifts, mins };
