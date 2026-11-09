/* Confidence of a photo read, and the list of things the reviewer should check.
   Shared by the browser (live, while reviewing) and the server (history and summary workbook). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MealsConf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * rows: [{ key, source, photo, row, nameAsWritten, id, officialName, marks:{day:bool}, uncertain:[day], disputed:[day],
   *          matchKind, matchScore, reviewed:{ days:[day], name:bool, id:bool }, deleted }]
   * days: report day keys. opts.unusualIds: IDs outside the batch pattern.
   * Returns { pct, sure, total, perPhoto:{n:{pct,sure,total,pending}}, items:[...] }
   *  - Each "candidate" cell (ticked, or flagged by the reader) counts once.
   *  - A cell is sure when the reader was sure (both reads agreed, nothing flagged) or the user reviewed it,
   *    and, if ticked, the name is matched to the list with certainty (exact, chosen by hand, or confirmed).
   */
  function assess(rows, days, opts) {
    opts = opts || {};
    const unusual = new Set(opts.unusualIds || []);
    const items = [], perPhoto = {};
    let sure = 0, total = 0;
    for (const r of rows || []) {
      if (!r || r.deleted) continue;
      const rv = r.reviewed || {}, revDays = new Set(rv.days || []);
      const unc = new Set(r.uncertain || []), dis = new Set(r.disputed || []);
      const anyMeal = days.some(d => r.marks && r.marks[d]);
      const nameUnsure = !rv.name && anyMeal && (!r.id || r.matchKind === 'fuzzy');
      const ph = r.photo == null ? 'manual' : r.photo;
      const pp = perPhoto[ph] = perPhoto[ph] || { sure: 0, total: 0, pending: 0 };
      const where = { key: r.key, photo: r.photo, row: r.row, source: r.source, name: r.nameAsWritten };
      for (const d of days) {
        const marked = !!(r.marks && r.marks[d]);
        if (!marked && !unc.has(d) && !dis.has(d)) continue;
        total++; pp.total++;
        const cellUnsure = !revDays.has(d) && (unc.has(d) || dis.has(d));
        if (!cellUnsure && !(nameUnsure && marked)) { sure++; pp.sure++; }
        if (cellUnsure) {
          pp.pending++;
          items.push({ ...where, kind: 'cell', day: d, marked,
            reason: dis.has(d) ? `Las dos lecturas no coinciden (${marked ? 'quedó con palomita' : 'quedó sin palomita'})` : `Marca dudosa (${marked ? 'quedó con palomita' : 'quedó sin palomita'})` });
        }
      }
      if (nameUnsure) {
        pp.pending++;
        items.push({ ...where, kind: 'name', reason: r.id ? `Nombre aproximado (${r.matchScore || '?'}%) → ${r.officialName || r.id}. Confirma que es la misma persona.` : 'SIN ID: el nombre no está en la lista de nuevos ingresos. Elige la persona correcta o confírmalo como SIN ID (no se agrega a DELPHI).' });
      }
      if (r.id && unusual.has(r.id) && anyMeal && !rv.id) {
        pp.pending++;
        items.push({ ...where, kind: 'id', reason: `El ID ${r.id} no sigue el patrón del lote. Confirma que es correcto.` });
      }
    }
    for (const k of Object.keys(perPhoto)) { const p = perPhoto[k]; p.pct = p.total ? Math.round(100 * p.sure / p.total) : 100; }
    return { pct: total ? Math.round(100 * sure / total) : 100, sure, total, perPhoto, items };
  }

  function label(pct) { return pct >= 95 ? 'alta' : pct >= 80 ? 'media' : 'baja'; }
  function itemText(it) {
    const where = `${it.source || 'Manual'}${it.row != null && it.row !== '' ? ' #' + it.row : ''} · ${it.name || '(sin nombre)'}`;
    return `${where}${it.day ? ' · ' + it.day : ''} — ${it.reason}`;
  }
  return { assess, label, itemText };
});
