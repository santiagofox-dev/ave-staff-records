/* Vacaciones por ley (México). Shared by the server and the Expedientes page.
   LFT art. 76 (reforma "vacaciones dignas", DOF 27-dic-2022, vigente desde 1-ene-2023):
     1 año 12 días · 2: 14 · 3: 16 · 4: 18 · 5: 20 · 6-10: 22 · 11-15: 24 · 16-20: 26 · 21-25: 28 · 26-30: 30 · 31-35: 32 …
   Before 2023 the law gave 6, 8, 10, 12, then 14 for years 5-9 and +2 every 5 years; an anniversary that fell
   before 1-ene-2023 earned the old amount.
   Art. 81: the vacation must be granted within the 6 months after the anniversary.
   Art. 516: the right prescribes one year after it became due (so ~18 months after the anniversary).
   The CONTPAQi kárdex is trusted first: its balance stands as of its date, and the law applies from there.
   Art. 80: prima vacacional of at least 25% of the salary of the vacation days. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.VAC = factory(); })(this, function () {
  'use strict';
  const REFORM = '2023-01-01';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const D = s => new Date(s + 'T12:00:00Z');
  const addMonths = (s, m) => { const d = D(s), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return ymd(d); };
  const addYears = (s, y) => addMonths(s, 12 * y);

  /** Days of vacation for the year of service `n` (1 = first anniversary), under the law in force on that anniversary. */
  function daysForYear(n, onDate) {
    if (n < 1) return 0;
    if (!onDate || onDate >= REFORM) return n <= 5 ? 10 + 2 * n : 20 + 2 * Math.ceil((n - 5) / 5);
    return n <= 4 ? 4 + 2 * n : 14 + 2 * Math.floor((n - 5) / 5); // law before 2023
  }

  /** Kinds of entries. 'FI' (falta sin justificar) is only a record: it does not use vacation days.
      'vacaciones' and 'falta' (a falta pasada a vacaciones) use days; 'kardex' is history from CONTPAQi. */
  const uses = t => t && t.kind !== 'FI';

  /** Full picture for one employee as of `today` (YYYY-MM-DD).
      emp.hire, emp.vac = { opening: { date, saldo, file }, taken: [{ id, from, to, days, kind, note, by, at }] }
      Days are NOT cumulative forever: each anniversary's days must be granted within 6 months (art. 81) and the
      right prescribes one year after that (art. 516), so each period expires 18 months after its anniversary.
      Days taken use the oldest period still in force first. */
  function summary(emp, today) {
    const hire = emp && emp.hire;
    const vac = (emp && emp.vac) || {}, taken = (vac.taken || []).slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''));
    const out = { hire: hire || '', years: 0, months: 0, periods: [], taken, balance: null, nextAnniversary: null, nextDays: null, thisYearDays: null, proportional: null, expired: 0, prescribed: 0, advanced: 0, nextExpiry: null, takeBy: null, opening: vac.opening || null, faltas: taken.filter(t => t.kind === 'FI').length };
    if (!hire || !/^\d{4}-\d{2}-\d{2}$/.test(hire) || hire > today) return out;
    // seniority
    let n = 0; while (addYears(hire, n + 1) <= today) n++;
    const last = addYears(hire, n);
    let m = 0; while (addMonths(last, m + 1) <= today) m++;
    out.years = n; out.months = m;
    const openDate = vac.opening ? vac.opening.date : '';
    for (let k = 1; k <= n; k++) {
      const date = addYears(hire, k), days = daysForYear(k, date);
      out.periods.push({ year: k, date, days, takeBy: addMonths(date, 6), prescribes: addMonths(date, 18), counted: !(openDate && date <= openDate), left: 0, used: 0 });
    }
    out.nextAnniversary = addYears(hire, n + 1); out.nextDays = daysForYear(n + 1, out.nextAnniversary);
    out.thisYearDays = n ? out.periods[n - 1].days : 0;
    const frac = (D(today) - D(last)) / (D(out.nextAnniversary) - D(last));
    out.proportional = Math.round(out.nextDays * frac * 100) / 100; // owed for the running year if the person leaves today
    const r2 = x => Math.round(x * 100) / 100;

    // starting point: the CONTPAQi kárdex comes first. Its balance is taken as correct on its date (nothing in it is
    // treated as expired then); the anniversaries before it are already inside that balance. From the kárdex date on,
    // the law applies: that balance is due on the kárdex date (give it within 6 months, art. 81; it prescribes a year
    // later, art. 516) and every later anniversary adds its own period. Without a kárdex, every period starts full.
    let debt = 0;
    if (vac.opening) {
      const saldo = +vac.opening.saldo || 0;
      if (saldo < 0) debt = -saldo;
      else if (saldo > 0) {
        const at = out.periods.findIndex(p => p.counted);
        out.periods.splice(at < 0 ? out.periods.length : at, 0, { year: 0, date: openDate, days: saldo, takeBy: addMonths(openDate, 6), prescribes: addMonths(openDate, 18), counted: false, left: saldo, used: 0, opening: true });
      }
    }
    // events after the starting point, in order: anniversaries add a period, days taken use the oldest one in force
    const ev = [];
    for (const p of out.periods) if (p.counted) ev.push({ at: p.date, o: 0, p });
    for (const t of taken) if (uses(t) && (!openDate || (t.from || '') > openDate)) ev.push({ at: t.from || '', o: 1, t });
    ev.sort((a, b) => a.at.localeCompare(b.at) || a.o - b.o);
    let used = 0, earned = 0;
    for (const x of ev) {
      if (x.p) {
        const p = x.p; earned += p.days; p.left = p.days;
        const pay = Math.min(debt, p.left); p.left = r2(p.left - pay); p.used = r2(p.used + pay); debt = r2(debt - pay);
        continue;
      }
      let need = +x.t.days || 0; used += need;
      for (const p of out.periods) {
        if (need <= 0) break;
        if (p.left <= 0 || p.date > x.at || p.prescribes < x.at) continue;
        const k = Math.min(need, p.left); p.left = r2(p.left - k); p.used = r2(p.used + k); need = r2(need - k);
      }
      debt = r2(debt + need); // taken in advance: comes out of the next anniversary
    }
    out.earned = earned; out.used = r2(used);
    let live = 0;
    for (const p of out.periods) {
      p.expired = p.left > 0 && p.prescribes < today;
      if (p.expired) out.expired = r2(out.expired + p.left); else live = r2(live + p.left);
    }
    out.prescribed = out.expired;
    out.advanced = debt;
    out.balance = r2(live - debt);
    // the next days to lose: the oldest period in force that still has days
    const nx = out.periods.find(p => p.left > 0 && !p.expired);
    if (nx) { out.nextExpiry = { date: nx.prescribes, days: nx.left, year: nx.year, takeBy: nx.takeBy }; out.takeBy = nx.takeBy; }
    return out;
  }

  /** Default number of days between two dates: Monday to Saturday (Sunday is the usual rest day). Editable. */
  function workDays(from, to) {
    if (!from || !to || to < from) return 0;
    let n = 0; for (let d = D(from); d <= D(to); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) n++;
    return n;
  }

  return { daysForYear, summary, workDays, addMonths, addYears, uses, REFORM };
});
