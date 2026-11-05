'use strict';
/* PDF reports. All dates are computed in Ciudad Juárez time, not the server's UTC clock. */
const PDFDocument = require('pdfkit');

const TZ = process.env.TZ_REPORTS || 'America/Ciudad_Juarez';
const C = { ink: '#1b2027', muted: '#5b6470', line: '#dadee4', accent: '#d4511b', bad: '#b42727', warn: '#9a6410', bday: '#7041b8', fill: '#f3f4f6' };
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/* ---------- dates ---------- */
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const utc = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const validISO = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const days = (from, to) => Math.round((utc(to) - utc(from)) / 864e5);
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const fmt = iso => { if (!validISO(iso)) return '—'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function bdayIn(e, year) { // that year's birthday as ISO, Feb 29 → Feb 28 in non-leap years
  if (!validISO(e.birthday)) return null;
  const [, m, d] = e.birthday.split('-').map(Number);
  return iso(year, m, (m === 2 && d === 29 && !isLeap(year)) ? 28 : d);
}
function nextBirthday(e, today) {
  const y = +today.slice(0, 4);
  let b = bdayIn(e, y); if (!b) return null;
  if (b < today) b = bdayIn(e, y + 1);
  return { date: b, in: days(today, b), turns: +b.slice(0, 4) - +e.birthday.slice(0, 4) };
}

/* ---------- data ---------- */
function collect(employees, windowDays) {
  const today = todayISO();
  const expired = [], expiring = [], noTraining = [];
  for (const e of employees) {
    const tr = e.trainings || [];
    if (!tr.length) noTraining.push(e);
    for (const t of tr) {
      if (!validISO(t.expires)) continue;
      const n = days(today, t.expires);
      if (n < 0) expired.push({ e, t, n });
      else if (n <= windowDays) expiring.push({ e, t, n });
    }
  }
  expired.sort((a, b) => a.n - b.n);
  expiring.sort((a, b) => a.n - b.n);
  const birthdays = employees.map(e => ({ e, b: nextBirthday(e, today) })).filter(x => x.b && x.b.in <= 30).sort((a, b) => a.b.in - b.b.in);
  noTraining.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { today, expired, expiring, birthdays, noTraining };
}

/* ---------- drawing helpers ---------- */
function newDoc(res, filename, title, layout = 'portrait') {
  const doc = new PDFDocument({ size: 'LETTER', layout, margin: 48, info: { Title: title, Author: 'Grupo AVE · Expedientes de Personal' }, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}
function header(doc, title, subtitle) {
  const x = doc.page.margins.left;
  doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(9).text('GRUPO AVE · EXPEDIENTES DE PERSONAL', x, 40, { characterSpacing: 1.2 });
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(20).text(title, x, 54);
  doc.fillColor(C.muted).font('Helvetica').fontSize(10).text(subtitle, x, doc.y + 2);
  doc.moveTo(x, doc.y + 8).lineTo(doc.page.width - doc.page.margins.right, doc.y + 8).strokeColor(C.line).lineWidth(1).stroke();
  doc.y += 20;
}
function footers(doc, today) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 36;
    const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.fillColor(C.muted).font('Helvetica').fontSize(8)
      .text(`Generado el ${fmt(today)} · Información confidencial del personal`, doc.page.margins.left, y, { lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, doc.page.margins.left, y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}
function section(doc, title, count, color) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  const x = doc.page.margins.left;
  doc.y += 6;
  doc.rect(x, doc.y + 2, 4, 14).fill(color);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(13).text(`${title}`, x + 12, doc.y, { continued: true })
    .fillColor(C.muted).font('Helvetica').text(`   ${count}`);
  doc.y += 6;
}
function table(doc, cols, rows, emptyText) {
  const x0 = doc.page.margins.left, width = doc.page.width - x0 - doc.page.margins.right;
  if (!rows.length) {
    doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(10).text(emptyText, x0, doc.y); doc.y += 12; return;
  }
  const total = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map(c => c.w / total * width);
  const drawHead = () => {
    let x = x0; const y = doc.y;
    doc.rect(x0, y, width, 18).fill(C.fill);
    cols.forEach((c, i) => { doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text(c.h.toUpperCase(), x + 6, y + 5, { width: widths[i] - 12, align: c.align || 'left', characterSpacing: .6 }); x += widths[i]; });
    doc.y = y + 18;
  };
  drawHead();
  for (const r of rows) {
    doc.font('Helvetica').fontSize(10);
    const h = Math.max(...r.map((v, i) => doc.heightOfString(String(v.text ?? v), { width: widths[i] - 12 }))) + 10;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 10) { doc.addPage(); doc.y = doc.page.margins.top; drawHead(); }
    let x = x0; const y = doc.y;
    r.forEach((v, i) => {
      const cell = typeof v === 'object' && v !== null ? v : { text: v };
      doc.fillColor(cell.color || C.ink).font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
        .text(String(cell.text ?? ''), x + 6, y + 5, { width: widths[i] - 12, align: cols[i].align || 'left' });
      x += widths[i];
    });
    doc.moveTo(x0, y + h).lineTo(x0 + width, y + h).strokeColor(C.line).lineWidth(.5).stroke();
    doc.y = y + h;
  }
  doc.y += 10;
}
const PL = { employee: ['empleado', 'empleados'], day: ['día', 'días'], 'expired training': ['capacitación vencida', 'capacitaciones vencidas'], event: ['evento', 'eventos'], year: ['año', 'años'] };
const plural = (n, w) => `${n} ${PL[w][n === 1 ? 0 : 1]}`;

/* ---------- reports ---------- */
function weekly(res, employees, windowDays) {
  const d = collect(employees, windowDays);
  const doc = newDoc(res, `AVE-weekly-report-${d.today}.pdf`, 'Reporte semanal');
  header(doc, 'Reporte semanal', `Semana del ${fmt(d.today)} · ${plural(employees.length, 'employee')} · aviso de vencimiento a ${windowDays} días`);

  section(doc, 'Capacitaciones vencidas', d.expired.length, C.bad);
  table(doc, [{ h: 'Empleado', w: 3 }, { h: 'Sitio', w: 2 }, { h: 'Capacitación', w: 3.4 }, { h: 'Venció', w: 1.6 }, { h: 'Atraso', w: 1.6, align: 'right' }],
    d.expired.map(x => [{ text: x.e.name, bold: true }, x.e.site || '—', x.t.name, fmt(x.t.expires), { text: plural(-x.n, 'day'), color: C.bad, bold: true }]),
    'No hay capacitaciones vencidas.');

  section(doc, `Por vencer en los próximos ${windowDays} días`, d.expiring.length, C.warn);
  table(doc, [{ h: 'Empleado', w: 3 }, { h: 'Sitio', w: 2 }, { h: 'Capacitación', w: 3.4 }, { h: 'Vence', w: 1.6 }, { h: 'Faltan', w: 1.6, align: 'right' }],
    d.expiring.map(x => [{ text: x.e.name, bold: true }, x.e.site || '—', x.t.name, fmt(x.t.expires), { text: x.n === 0 ? 'Hoy' : plural(x.n, 'day'), color: C.warn, bold: true }]),
    `Nada vence en los próximos ${windowDays} días.`);

  section(doc, 'Cumpleaños de los próximos 30 días', d.birthdays.length, C.bday);
  table(doc, [{ h: 'Empleado', w: 3 }, { h: 'Sitio', w: 2 }, { h: 'Puesto', w: 2.6 }, { h: 'Cumpleaños', w: 1.6 }, { h: 'Cumple', w: 1.2, align: 'right' }, { h: 'En', w: 1.1, align: 'right' }],
    d.birthdays.map(x => [{ text: x.e.name, bold: true }, x.e.site || '—', x.e.position || '—', fmt(x.b.date), String(x.b.turns), { text: x.b.in === 0 ? 'Hoy' : plural(x.b.in, 'day'), color: C.bday, bold: true }]),
    'No hay cumpleaños en los próximos 30 días.');

  footers(doc, d.today); doc.end();
}

function pastDue(res, employees) {
  const d = collect(employees, 0);
  const doc = newDoc(res, `AVE-past-due-${d.today}.pdf`, 'Capacitaciones vencidas');
  const people = new Set(d.expired.map(x => x.e.id)).size;
  header(doc, 'Capacitaciones vencidas', `Al ${fmt(d.today)} · ${plural(d.expired.length, 'expired training')} de ${plural(people, 'employee')}`);

  section(doc, 'De la más atrasada a la más reciente', d.expired.length, C.bad);
  table(doc, [{ h: 'Empleado', w: 3 }, { h: 'Sitio', w: 2 }, { h: 'Teléfono', w: 1.8 }, { h: 'Capacitación', w: 3.2 }, { h: 'Venció', w: 1.6 }, { h: 'Atraso', w: 1.6, align: 'right' }],
    d.expired.map(x => [{ text: x.e.name, bold: true }, x.e.site || '—', x.e.phone || '—', x.t.name, fmt(x.t.expires), { text: plural(-x.n, 'day'), color: C.bad, bold: true }]),
    'No hay capacitaciones vencidas. Todos están al día.');

  section(doc, 'Empleados sin capacitaciones registradas', d.noTraining.length, C.muted);
  table(doc, [{ h: 'Empleado', w: 3 }, { h: 'Puesto', w: 2.6 }, { h: 'Sitio', w: 2 }, { h: 'Ingreso', w: 1.6 }],
    d.noTraining.map(e => [{ text: e.name, bold: true }, e.position || '—', e.site || '—', fmt(e.hire)]),
    'Todos los empleados tienen al menos una capacitación registrada.');

  footers(doc, d.today); doc.end();
}

function calendar(res, employees, month /* YYYY-MM */) {
  const today = todayISO();
  const [Y, M] = month.split('-').map(Number);
  const dim = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(Y, M - 1, 1)).getUTCDay(); // 0 = Sunday

  // events by day
  const ev = {};
  const add = (day, item) => (ev[day] = ev[day] || []).push(item);
  for (const e of employees) {
    const b = bdayIn(e, Y);
    if (b && +b.slice(5, 7) === M) add(+b.slice(8), { kind: 'bday', text: e.name, sub: `Cumpleaños · cumple ${Y - +e.birthday.slice(0, 4)}`, e });
    if (validISO(e.hire)) {
      const [hy, hm, hd] = e.hire.split('-').map(Number);
      if (hm === M && hy < Y) add(Math.min(hd, dim), { kind: 'anniv', text: e.name, sub: `${plural(Y - hy, 'year')} en Grupo AVE`, e });
    }
    for (const t of e.trainings || []) {
      if (validISO(t.expires) && t.expires.slice(0, 7) === month) add(+t.expires.slice(8), { kind: 'exp', text: e.name, sub: `Vence ${t.name}`, e });
    }
  }
  const colorOf = k => k === 'bday' ? C.bday : k === 'exp' ? C.bad : C.accent;
  const labelOf = k => k === 'bday' ? 'C' : k === 'exp' ? 'V' : 'A';

  const doc = newDoc(res, `AVE-calendar-${month}.pdf`, `Calendario ${MONTHS[M - 1]} ${Y}`, 'landscape');
  const count = Object.values(ev).reduce((s, l) => s + l.length, 0);
  header(doc, `${MONTHS[M - 1]} ${Y}`, `${plural(count, 'event')} · C = cumpleaños · V = vence capacitación · A = aniversario laboral`);

  const x0 = doc.page.margins.left, width = doc.page.width - x0 - doc.page.margins.right;
  const top = doc.y + 4, weeks = Math.ceil((firstDow + dim) / 7);
  const cw = width / 7, headH = 18, ch = (doc.page.height - 56 - top - headH) / weeks;
  ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].forEach((d, i) => {
    doc.rect(x0 + i * cw, top, cw, headH).fill(C.fill);
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text(d.toUpperCase(), x0 + i * cw, top + 5, { width: cw, align: 'center', characterSpacing: .8 });
  });
  let todayBox = null;
  for (let cell = 0; cell < weeks * 7; cell++) {
    const day = cell - firstDow + 1, col = cell % 7, row = Math.floor(cell / 7);
    const x = x0 + col * cw, y = top + headH + row * ch;
    doc.rect(x, y, cw, ch).strokeColor(C.line).lineWidth(.6).stroke();
    if (day < 1 || day > dim) { doc.rect(x + .3, y + .3, cw - .6, ch - .6).fill('#fafafb'); continue; }
    const isToday = iso(Y, M, day) === today;
    if (isToday) todayBox = [x, y];
    doc.fillColor(isToday ? C.accent : C.ink).font('Helvetica-Bold').fontSize(10).text(String(day), x + 5, y + 4, { lineBreak: false });
    const items = ev[day] || [];
    const maxLines = Math.max(1, Math.floor((ch - 20) / 10));
    items.slice(0, items.length > maxLines ? maxLines - 1 : maxLines).forEach((it, i) => {
      const ly = y + 18 + i * 10;
      doc.fillColor(colorOf(it.kind)).font('Helvetica-Bold').fontSize(7).text(labelOf(it.kind), x + 5, ly, { lineBreak: false });
      doc.fillColor(C.ink).font('Helvetica').fontSize(7).text(it.text, x + 13, ly, { width: cw - 17, height: 9, ellipsis: true, lineBreak: false });
    });
    if (items.length > maxLines) doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(7).text(`+${items.length - maxLines + 1} más (ver lista)`, x + 5, y + 18 + (maxLines - 1) * 10, { lineBreak: false });
  }

  if (todayBox) doc.rect(todayBox[0] + .75, todayBox[1] + .75, cw - 1.5, ch - 1.5).lineWidth(1.5).strokeColor(C.accent).stroke();

  // page 2: full list
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 48 });
  header(doc, `${MONTHS[M - 1]} ${Y} · todos los eventos`, 'Ordenados por fecha');
  const rows = [];
  Object.keys(ev).map(Number).sort((a, b) => a - b).forEach(day => ev[day].forEach(it => rows.push([
    fmt(iso(Y, M, day)),
    { text: it.kind === 'bday' ? 'Cumpleaños' : it.kind === 'exp' ? 'Vence capacitación' : 'Aniversario laboral', color: colorOf(it.kind), bold: true },
    { text: it.e.name, bold: true }, it.e.site || '—', it.kind === 'exp' ? it.sub.replace(/^Vence /, '') : it.sub,
  ])));
  table(doc, [{ h: 'Fecha', w: 1.5 }, { h: 'Tipo', w: 1.7 }, { h: 'Empleado', w: 2.8 }, { h: 'Sitio', w: 2 }, { h: 'Detalle', w: 3.4 }], rows, 'No hay eventos este mes.');
  footers(doc, today); doc.end();
}

module.exports = { weekly, pastDue, calendar, todayISO };
