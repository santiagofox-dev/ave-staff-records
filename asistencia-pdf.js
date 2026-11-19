'use strict';
/* Printable LISTA DE ASISTENCIA, pre-filled from the CHECADOR. Built to be read back from a phone photo:
   corner markers, a printed sheet code, fixed rows, and two boxes per day (Clave / TE). */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const A = require('./asistencia-core');

const LOGO = path.join(__dirname, 'public', 'site', 'assets', 'logo-grupo-ave.png');
const C = { ink: '#1F2328', grid: '#9AA0A6', shade: '#D9DCE0', alt: '#F4F5F7', muted: '#5B6470', faint: '#6B7280' };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function sheetsPdf(out, sheets) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0, info: { Title: 'Lista de asistencia', Author: 'Grupo AVE' } });
  doc.pipe(out);
  const W = 792, H = 612, M = 28;
  sheets.forEach((s, n) => { if (n) doc.addPage(); page(doc, s, W, H, M); });
  doc.end();
}

function marker(doc, x, y) {
  doc.rect(x, y, 16, 16).fill('#000');
  doc.rect(x + 4, y + 4, 8, 8).fill('#fff');
  doc.rect(x + 6, y + 6, 4, 4).fill('#000');
}

function page(doc, s, W, H, M) {
  for (const [x, y] of [[M - 14, M - 14], [W - M - 2, M - 14], [M - 14, H - M - 2], [W - M - 2, H - M - 2]]) marker(doc, x, y);
  const days = A.weekDates(s.monday);
  const end = A.addDays(s.monday, 6);
  if (fs.existsSync(LOGO)) doc.image(LOGO, M + 8, M + 6, { width: 96 });
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(17).text('LISTA DE ASISTENCIA', M + 120, M + 4, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).text(`Planta: ${s.plant}  ·  Turno: ${s.turno}${A.shiftFor(s.turno) ? ` (${A.shiftFor(s.turno).start} a ${A.shiftFor(s.turno).end})` : ''}  ·  Semana del ${A.ddmm(s.monday)} al ${A.ddmm(end)}/${end.slice(0, 4)}`, M + 120, M + 25, { lineBreak: false });
  doc.fillColor(C.muted).fontSize(8.5).text('Clave vacía = asistió normal.  En TE escribe solo el número de horas extra (ej. 2 o 1.5).  Días sombreados = descanso según el checador (si trabajó, anota TE).', M + 120, M + 40, { lineBreak: false });
  // sheet code box (read by the system to know plant, turno, week and page)
  const cw = 150, cx = W - M - cw;
  doc.lineWidth(1.4).strokeColor(C.ink).rect(cx, M + 2, cw, 34).stroke();
  doc.fillColor(C.muted).font('Helvetica').fontSize(6.5).text(`CÓDIGO DE HOJA  ·  HOJA ${s.page} DE ${s.pages}`, cx, M + 6, { width: cw, align: 'center', lineBreak: false });
  doc.fillColor(C.ink).font('Courier-Bold').fontSize(12).text(s.code, cx, M + 17, { width: cw, align: 'center', lineBreak: false });

  const top = H - M - 76 - 0, tableTop = M + 58, rowh = 20.5;
  const colID = 44, colName = 186, dayw = 66, firma = W - 2 * M - colID - colName - 6 * dayw;
  const x0 = M, xs = [x0, x0 + colID, x0 + colID + colName];
  for (let i = 1; i <= 6; i++) xs.push(xs[2] + dayw * i);
  const hh = 30;
  doc.rect(x0, tableTop, W - 2 * M, hh).fill(C.ink);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
  doc.text('ID', x0, tableTop + 11, { width: colID, align: 'center', lineBreak: false });
  doc.text('NOMBRE (checador)', x0 + colID + 6, tableTop + 11, { lineBreak: false });
  days.forEach((d, i) => {
    const cx2 = xs[2] + dayw * i;
    doc.font('Helvetica-Bold').fontSize(9).text(`${A.DAY_LABEL[d.key]} ${A.ddmm(d.ymd)}`, cx2, tableTop + 5, { width: dayw, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).text('Clave', cx2, tableTop + 18, { width: dayw * 0.56, align: 'center', lineBreak: false });
    doc.text('TE', cx2 + dayw * 0.56, tableTop + 18, { width: dayw * 0.44, align: 'center', lineBreak: false });
  });
  doc.font('Helvetica-Bold').fontSize(9).text('FIRMA', xs[8], tableTop + 11, { width: firma, align: 'center', lineBreak: false });

  const rows = [...s.rows, ...Array(s.blanks || 0).fill(null)];
  let y = tableTop + hh;
  rows.forEach((p, k) => {
    if (k % 2) doc.rect(x0, y, W - 2 * M, rowh).fill(C.alt);
    days.forEach((d, i) => {
      if (p && p.rest.includes(d.key)) {
        const cx2 = xs[2] + dayw * i;
        doc.rect(cx2, y, dayw * 0.56, rowh).fill(C.shade);
        doc.fillColor(C.faint).font('Helvetica').fontSize(6.5).text('descanso', cx2 + 3, y + rowh - 9, { lineBreak: false });
      }
    });
    if (p) {
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(p.id, x0, y + 6, { width: colID, align: 'center', lineBreak: false });
      const nm = p.name.toUpperCase();
      doc.font('Helvetica').fontSize(nm.length < 30 ? 8.4 : nm.length < 36 ? 7.6 : 6.8).text(nm, x0 + colID + 5, y + 7, { width: colName - 8, lineBreak: false, ellipsis: true });
    } else {
      doc.fillColor(C.faint).font('Helvetica').fontSize(7).text('Nuevo: escribe ID y nombre', x0 + colID + 5, y + 7, { lineBreak: false });
    }
    y += rowh;
  });
  const bottom = y;
  doc.strokeColor(C.grid).lineWidth(0.6);
  for (let k = 0; k <= rows.length; k++) doc.moveTo(x0, tableTop + hh + k * rowh).lineTo(W - M, tableTop + hh + k * rowh).stroke();
  for (const xv of [...xs, W - M]) doc.lineWidth(xs.indexOf(xv) >= 2 ? 1.3 : 0.6).moveTo(xv, tableTop).lineTo(xv, bottom).stroke();
  doc.lineWidth(0.5);
  for (let i = 0; i < 6; i++) { const xm = xs[2] + dayw * i + dayw * 0.56; doc.moveTo(xm, tableTop + 17).lineTo(xm, bottom).stroke(); }
  doc.strokeColor(C.ink).lineWidth(1.2).rect(x0, tableTop, W - 2 * M, bottom - tableTop).stroke();

  const ly = bottom + 10;
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9).text('CLAVES:', x0, ly, { lineBreak: false });
  doc.font('Helvetica').text('FI = Falta injustificada     INC = Incapacidad     VAC = Vacaciones     PSS = Permiso sin goce de sueldo     (vacío = asistió)', x0 + 50, ly, { lineBreak: false });
  doc.text('TE = solo el número de horas extra de ese día.  Usa pluma azul o negra y escribe dentro del cuadro; si te equivocas, tacha y escribe al lado.', x0, ly + 14, { lineBreak: false });
  doc.lineWidth(0.8).moveTo(W - M - 250, ly + 44).lineTo(W - M, ly + 44).stroke();
  doc.fontSize(8.5).text('Revisó (gerente): nombre y firma', W - M - 250, ly + 48, { lineBreak: false });
}

const weekTitle = monday => { const e = A.addDays(monday, 6); return `${+monday.slice(8)} ${MES[+monday.slice(5, 7) - 1]} – ${+e.slice(8)} ${MES[+e.slice(5, 7) - 1]} ${e.slice(0, 4)}`; };

module.exports = { sheetsPdf, weekTitle };
