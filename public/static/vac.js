/* Vacaciones por ley (México). Shared by the server and the Expedientes page.
   LFT art. 76 (reforma "vacaciones dignas", DOF 27-dic-2022, vigente desde 1-ene-2023):
     1 año 12 días · 2: 14 · 3: 16 · 4: 18 · 5: 20 · 6-10: 22 · 11-15: 24 · 16-20: 26 · 21-25: 28 · 26-30: 30 · 31-35: 32 …
   Before 2023 the law gave 6, 8, 10, 12, then 14 for years 5-9 and +2 every 5 years; an anniversary that fell
   before 1-ene-2023 earned the old amount.
   Art. 81: the vacation must be granted within the 6 months after the anniversary.
   Art. 516: the right prescribes one year after it became due (so ~18 months after the anniversary).
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

  /** Full picture for one employee as of `today` (YYYY-MM-DD).
      emp.hire, emp.vac = { opening: { date, saldo, file }, taken: [{ id, from, to, days, kind, note, by, at }] } */
  function summary(emp, today) {
    const hire = emp && emp.hire;
    const vac = (emp && emp.vac) || {}, taken = (vac.taken || []).slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''));
    const out = { hire: hire || '', years: 0, months: 0, periods: [], taken, balance: null, nextAnniversary: null, nextDays: null, thisYearDays: null, proportional: null, prescribed: 0, opening: vac.opening || null };
    if (!hire || !/^\d{4}-\d{2}-\d{2}$/.test(hire) || hire > today) return out;
    // seniority
    let n = 0; while (addYears(hire, n + 1) <= today) n++;
    const last = addYears(hire, n);
    let m = 0; while (addMonths(last, m + 1) <= today) m++;
    out.years = n; out.months = m;
    for (let k = 1; k <= n; k++) {
      const date = addYears(hire, k);
      out.periods.push({ year: k, date, days: daysForYear(k, date), takeBy: addMonths(date, 6), prescribes: addMonths(date, 18), counted: !(vac.opening && date <= vac.opening.date) });
    }
    out.nextAnniversary = addYears(hire, n + 1); out.nextDays = daysForYear(n + 1, out.nextAnniversary);
    out.thisYearDays = n ? out.periods[n - 1].days : 0;
    const frac = (D(today) - D(last)) / (D(out.nextAnniversary) - D(last));
    out.proportional = Math.round(out.nextDays * frac * 100) / 100; // owed for the running year if the person leaves today
    // balance: opening (CONTPAQi kárdex) + anniversaries after it − days taken after it
    const openDate = vac.opening ? vac.opening.date : '';
    const earned = out.periods.filter(p => p.counted).reduce((a, p) => a + p.days, 0);
    const used = taken.filter(t => !openDate || (t.from || '') > openDate).reduce((a, t) => a + (+t.days || 0), 0);
    out.balance = Math.round(((vac.opening ? +vac.opening.saldo || 0 : 0) + earned - used) * 100) / 100;
    out.earned = earned; out.used = used;
    // days that, by the oldest-first rule, belong to periods more than 18 months old (Art. 516: may be prescribed)
    if (!vac.opening) {
      let left = used, old = 0;
      for (const p of out.periods) { const rem = Math.max(0, p.days - left); left = Math.max(0, left - p.days); if (p.prescribes < today) old += rem; }
      out.prescribed = old;
    }
    // the period currently being used and its deadline (Art. 81)
    const cur = out.periods.slice(-1)[0];
    out.takeBy = cur && out.balance > 0 ? cur.takeBy : null;
    return out;
  }

  /** Default number of days between two dates: Monday to Saturday (Sunday is the usual rest day). Editable. */
  function workDays(from, to) {
    if (!from || !to || to < from) return 0;
    let n = 0; for (let d = D(from); d <= D(to); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) n++;
    return n;
  }

  return { daysForYear, summary, workDays, addMonths, addYears, REFORM };
});
