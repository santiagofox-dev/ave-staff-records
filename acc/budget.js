'use strict';
/* Presupuesto semanal por sucursal (Vero, Nov 2026): a weekly spending cap per site and category.
   Spending = supplier payments made that week (by the plant of each invoice paid and the supplier's category)
   + manual entries (nómina, IMSS, etc.). Facturas cargadas that week are shown next to it as what is coming. */
const { randomBytes } = require('crypto');

const CATS = [
  ['comida', 'Proveedores comida'], ['refrescos', 'Proveedores refrescos'], ['otros', 'Proveedores otros'], ['credito', 'Proveedores a crédito'],
  ['cxp', 'Cuentas por pagar anteriores'], ['nomina', 'Nómina'], ['impuestos', 'Impuestos / IVA / IMSS'], ['ahorro', 'Ahorro'], ['aguinaldo', 'Aguinaldo'],
  ['intereses', 'Intereses / préstamo bancario'], ['renta', 'Renta'], ['servicios', 'Servicios (luz, agua, internet)'], ['gas', 'Gas'],
  ['remodelacion', 'Remodelación'], ['equipo', 'Equipo'],
];
const CAT_LABEL = Object.fromEntries(CATS);
CAT_LABEL.sin = 'Sin categoría';

/* Sites as Vero budgets them, and which plants feed each one */
const DEFAULT_SITES = [
  { id: 'monclova', name: 'Monclova', plants: ['Versigent'] },
  { id: 'tijuana', name: 'Tijuana', plants: ['Aptiv Tijuana'] },
  { id: 'one', name: 'One Mobility', plants: ['ONE'] },
  { id: 'mtc', name: 'MTC', plants: ['MTC'] },
  { id: 'jabil', name: 'Jabil Chihuahua', plants: ['Jabil B1', 'Jabil B3'] },
  { id: 'jabil-torres', name: 'Jabil Torres', plants: ['Jabil Torres'] },
  { id: 'wistron', name: 'Wistron', plants: ['Wistron'] },
];
/* Vero's weekly sheet (Nov 2026), used until someone edits a week */
const DEFAULT_BUDGET = {
  monclova: { comida: 213000, refrescos: 80000, nomina: 95000 },
  tijuana: { comida: 25000, refrescos: 3000, otros: 18000, nomina: 32000, servicios: 12000, gas: 2000 },
  one: { comida: 62000, otros: 10000, nomina: 70000 },
  mtc: { comida: 45000, refrescos: 6000, otros: 20000, credito: 270000, nomina: 180000, impuestos: 31100 },
  jabil: { comida: 115000, refrescos: 45000, otros: 100000, credito: 1170000, nomina: 500000, impuestos: 200000, intereses: 50000, servicios: 65000 },
  'jabil-torres': { otros: 18000 },
  wistron: { servicios: 30000, nomina: 18000 },
};

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const mondayOf = s => { const d = new Date(s + 'T12:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };

/** Suggestion for a supplier's category from its name (the user confirms it). */
function guessCat(name) {
  const n = String(name || '').toUpperCase();
  if (/COCA|ARCA|PEPSI|BEBIDA|REFRESC|AGUA PURIF|EMBOTELLAD|JUGOS|GATORADE|BONAFONT|CIEL|ELECTROPURA/.test(n)) return 'refrescos';
  if (/GAS\b|GAS LP|ENERG[EÉ]TICOS|COMBUSTIBLE/.test(n)) return 'gas';
  if (/COMISI[OÓ]N FEDERAL|\bCFE\b|JUNTA MUNICIPAL|AGUA Y SANEAMIENTO|TELMEX|TOTALPLAY|MEGACABLE|TELEFON/.test(n)) return 'servicios';
  if (/BANCO|BANORTE|MIFEL|BBVA|SANTANDER|HSBC|SCOTIABANK|BANREGIO|BANAMEX|INBURSA/.test(n)) return 'intereses';
  if (/OFFICE DEPOT|OFFICEMAX|HOME DEPOT|LIMPIEZA|PAPELER|FERRETER|DESECHABLE|PLAST/.test(n)) return 'otros';
  return null;
}

function store(books) {
  const db = books.db;
  db.budget = db.budget || { weeks: {}, sites: null, spend: [] };
  db.budget.weeks = db.budget.weeks || {}; db.budget.spend = db.budget.spend || [];
  return db.budget;
}
const sites = books => store(books).sites || DEFAULT_SITES;

/** Budget for a week: the week's own, else the closest earlier week that has one, else Vero's sheet. */
function budgetFor(books, week) {
  const B = store(books);
  if (B.weeks[week]) return { amounts: B.weeks[week], from: week };
  const prev = Object.keys(B.weeks).filter(w => w < week).sort().pop();
  if (prev) return { amounts: B.weeks[prev], from: prev };
  return { amounts: DEFAULT_BUDGET, from: null };
}
function setBudget(books, week, amounts, user) {
  const B = store(books);
  const clean = {};
  for (const s of sites(books)) {
    const row = (amounts || {})[s.id] || {};
    const o = {};
    for (const [k] of CATS) { const v = r2(row[k]); if (v > 0) o[k] = v; }
    clean[s.id] = o;
  }
  B.weeks[week] = clean;
  books.log(user, 'editó', 'presupuesto', week, `Semana del ${week}`);
  return clean;
}

function addSpend(books, data, user) {
  const B = store(books);
  const date = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('Falta la fecha.'), { status: 400 });
  if (!sites(books).some(s => s.id === data.site)) throw Object.assign(new Error('Elige la sucursal.'), { status: 400 });
  if (!CAT_LABEL[data.cat] || data.cat === 'sin') throw Object.assign(new Error('Elige el concepto.'), { status: 400 });
  const amount = r2(data.amount);
  if (!(amount > 0)) throw Object.assign(new Error('El monto debe ser mayor a cero.'), { status: 400 });
  const e = { id: randomBytes(8).toString('hex'), date, site: data.site, cat: data.cat, amount, note: String(data.note || '').slice(0, 200), by: user, at: new Date().toISOString() };
  B.spend.push(e);
  books.log(user, 'registró', 'gasto de presupuesto', e.id, `${CAT_LABEL[e.cat]} ${amount.toFixed(2)}`);
  return e;
}
function removeSpend(books, id, user) {
  const B = store(books), i = B.spend.findIndex(x => x.id === id);
  if (i < 0) throw Object.assign(new Error('No se encontró ese gasto.'), { status: 404 });
  const [e] = B.spend.splice(i, 1);
  books.log(user, 'borró', 'gasto de presupuesto', e.id, `${CAT_LABEL[e.cat]} ${e.amount.toFixed(2)}`);
}

/** Week report: per site and category, budget vs paid (payments + manual) and facturas cargadas. */
function report(books, weekIn) {
  const week = mondayOf(weekIn), end = addDays(week, 6);
  const S = sites(books), siteOfPlant = {};
  for (const s of S) for (const p of s.plants) siteOfPlant[p] = s.id;
  const { amounts, from } = budgetFor(books, week);
  const cell = {};
  const get = (site, cat) => { const k = site + '|' + cat; return cell[k] = cell[k] || { paid: 0, manual: 0, invoiced: 0, items: [] }; };
  const catOf = (d, p) => (d && d.budgetCat) || (p && p.budgetCat) || 'sin';
  const siteOfPartner = p => { const ss = [...new Set((p && p.plants || []).map(x => siteOfPlant[x]).filter(Boolean))]; return ss.length === 1 ? ss[0] : null; };
  const siteOfDoc = (d, p) => { const pl = books.plantOf(d); return pl ? siteOfPlant[pl] || 'otras' : siteOfPartner(p) || 'sin'; };
  const uncategorized = {};
  // payments made this week
  for (const pay of books.db.payments) {
    if (pay.state !== 'posted' || pay.dir !== 'out' || pay.date < week || pay.date > end) continue;
    const p = books.partner(pay.partnerId);
    let rest = pay.amount;
    for (const a of pay.allocations || []) {
      const d = books.doc(a.docId); rest -= a.amount;
      const site = siteOfDoc(d, p), cat = catOf(d, p);
      const c = get(site, cat); c.paid = r2(c.paid + a.amount);
      c.items.push({ kind: 'pago', id: pay.id, number: pay.number, date: pay.date, partner: p ? p.name : '', doc: d ? `${d.serie || ''}${d.folio || ''}` || d.number : '', amount: r2(a.amount) });
      if (cat === 'sin' && p) { const u = uncategorized[p.id] = uncategorized[p.id] || { partnerId: p.id, name: p.name, paid: 0, invoiced: 0, guess: guessCat(p.name) }; u.paid = r2(u.paid + a.amount); }
    }
    if (rest > 0.009) {
      const site = siteOfPartner(p) || 'sin', cat = catOf(null, p);
      const c = get(site, cat); c.paid = r2(c.paid + rest);
      c.items.push({ kind: 'pago', id: pay.id, number: pay.number, date: pay.date, partner: p ? p.name : '', doc: 'anticipo / sin factura', amount: r2(rest) });
      if (cat === 'sin' && p) { const u = uncategorized[p.id] = uncategorized[p.id] || { partnerId: p.id, name: p.name, paid: 0, invoiced: 0, guess: guessCat(p.name) }; u.paid = r2(u.paid + rest); }
    }
  }
  // facturas cargadas this week (by invoice date)
  for (const d of books.db.docs) {
    if (d.state !== 'posted' || d.date < week || d.date > end || !/^(in_invoice|in_refund)$/.test(d.type)) continue;
    const p = books.partner(d.partnerId), site = siteOfDoc(d, p), cat = catOf(d, p);
    const sign = d.type === 'in_refund' ? -1 : 1;
    const c = get(site, cat); c.invoiced = r2(c.invoiced + sign * (d.totalMxn || 0));
    if (cat === 'sin' && p) { const u = uncategorized[p.id] = uncategorized[p.id] || { partnerId: p.id, name: p.name, paid: 0, invoiced: 0, guess: guessCat(p.name) }; u.invoiced = r2(u.invoiced + sign * (d.totalMxn || 0)); }
  }
  // manual entries (nómina, IMSS, …)
  const manual = store(books).spend.filter(e => e.date >= week && e.date <= end);
  for (const e of manual) { const c = get(e.site, e.cat); c.manual = r2(c.manual + e.amount); }
  const out = [];
  for (const s of [...S, { id: 'otras', name: 'Otras plantas (sin sucursal)', plants: [] }, { id: 'sin', name: 'Sin planta asignada', plants: [] }]) {
    const bud = amounts[s.id] || {};
    const cats = [...CATS.map(c => c[0]), 'sin'].filter(k => bud[k] || cell[s.id + '|' + k]);
    if (!cats.length && (s.id === 'otras' || s.id === 'sin')) continue;
    const rows = cats.map(k => {
      const c = cell[s.id + '|' + k] || { paid: 0, manual: 0, invoiced: 0, items: [] };
      const budget = r2(bud[k] || 0), spent = r2(c.paid + c.manual);
      return { cat: k, label: CAT_LABEL[k], budget, paid: c.paid, manual: c.manual, spent, invoiced: c.invoiced, available: r2(budget - spent), pct: budget ? Math.round(spent / budget * 100) : null, items: c.items.sort((a, b) => a.date.localeCompare(b.date)) };
    });
    const t = rows.reduce((a, r) => ({ budget: a.budget + r.budget, spent: a.spent + r.spent, invoiced: a.invoiced + r.invoiced }), { budget: 0, spent: 0, invoiced: 0 });
    out.push({ id: s.id, name: s.name, plants: s.plants, rows, totals: { budget: r2(t.budget), spent: r2(t.spent), invoiced: r2(t.invoiced), available: r2(t.budget - t.spent), pct: t.budget ? Math.round(t.spent / t.budget * 100) : null } });
  }
  const g = out.reduce((a, s) => ({ budget: a.budget + s.totals.budget, spent: a.spent + s.totals.spent, invoiced: a.invoiced + s.totals.invoiced }), { budget: 0, spent: 0, invoiced: 0 });
  return { week, end, budgetFrom: from, sites: out, totals: { budget: r2(g.budget), spent: r2(g.spent), invoiced: r2(g.invoiced), available: r2(g.budget - g.spent) },
    manual: manual.map(e => ({ ...e, label: CAT_LABEL[e.cat], siteName: (S.find(s => s.id === e.site) || {}).name || e.site })),
    uncategorized: Object.values(uncategorized).sort((a, b) => b.paid + b.invoiced - a.paid - a.invoiced),
    cats: CATS.map(([id, label]) => ({ id, label })), siteList: S.map(s => ({ id: s.id, name: s.name, plants: s.plants })) };
}

/** What's left for one supplier's site/category this week (shown while registering a payment). */
function availableFor(books, partnerId, date) {
  const p = books.partner(partnerId); if (!p) return null;
  const rep = report(books, date || ymd(new Date()));
  const S = sites(books), plantSites = [...new Set((p.plants || []).map(pl => (S.find(s => s.plants.includes(pl)) || {}).id).filter(Boolean))];
  const cat = p.budgetCat || 'sin';
  return { cat, catLabel: CAT_LABEL[cat], week: rep.week, sites: plantSites.map(id => { const s = rep.sites.find(x => x.id === id); const row = s && s.rows.find(r => r.cat === cat); return { id, name: s ? s.name : id, budget: row ? row.budget : 0, spent: row ? row.spent : 0, available: row ? row.available : 0 }; }) };
}

module.exports = { CATS, CAT_LABEL, DEFAULT_SITES, DEFAULT_BUDGET, guessCat, budgetFor, setBudget, addSpend, removeSpend, report, availableFor, mondayOf };
