'use strict';
/* The only AI step: read one photo of an INGRESOS sheet with the Claude API and return strict JSON. */
const fs = require('fs');

const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const hasKey = () => !!process.env.ANTHROPIC_API_KEY;

const PROMPT = `Eres un lector de hojas de registro de comidas de un comedor industrial. La foto muestra una hoja impresa titulada "INGRESOS <fecha>" con columnas "#", "NOMBRE" y una columna por día (por ejemplo 2-Nov, 3-Nov … 6-Nov). El personal de cocina marca a mano cada comida.

Registra la hoja llamando a la herramienta "registrar_hoja" (una sola vez, con todos los renglones).

Reglas:
- "day_columns" son los encabezados de día tal como están impresos (ej. "2-Nov"). En "marks" usa exactamente esas mismas claves, una por cada día, en cada renglón.
- Cualquier marca dentro de una celda de día (palomita, punto, diagonal, guion, garabato, en pluma o lápiz de cualquier color) = true. Celda vacía = false.
- Incluye TODOS los renglones con nombre, también los nombres escritos a mano debajo de la tabla impresa (row_number null si no tienen número). Copia el nombre tal como está escrito, en mayúsculas.
- La foto suele estar inclinada y las líneas de la tabla están en diagonal. Asigna cada marca a su renglón siguiendo las líneas impresas de la cuadrícula alrededor de la marca, NO por el nombre con el que parece alinearse a simple vista. Es común que una marca parezca alineada con el renglón de abajo. Los renglones compactos (letra más chica) son los más propensos a error: revísalos con cuidado.
- Una columna de día puede haberla llenado otra persona con otro estilo (por ejemplo un día todo con palomitas de lápiz y los demás con puntos de plumón). Algunas palomitas pueden salirse del borde derecho de la tabla: cuéntalas igual, pero agrega ese día a "uncertain_cells".
- MARCAS FUERA DE LA TABLA: a veces el último día (la columna de la derecha) se marcó con diagonales o palomitas de lápiz que caen a la derecha del borde de la tabla. Revisa esa franja renglón por renglón siguiendo la inclinación de las líneas impresas: cada trazo cuenta como true para el último día del renglón cuya línea continúa. Marca true SOLO donde realmente veas un trazo; no supongas que todos los renglones tienen uno. Pon esos días en "uncertain_cells".
- En la parte baja de la foto la inclinación suele ser mayor: antes de asignar una marca, confirma entre qué dos líneas horizontales cae su centro, contando las líneas desde el último renglón con número visible.
- Las palomitas encimadas, repasadas o tachadas cuentan como 1 comida: márcalas true, agrega el día a "uncertain_cells" y explícalo en "note".
- Si un mismo nombre aparece dos veces, devuelve ambos renglones (no los combines).
- Si no estás seguro de si una celda tiene marca, o de a qué renglón pertenece, pon tu mejor lectura y agrega el día a "uncertain_cells".
- "note": vacío "" salvo que haya algo que el revisor deba saber (marca fuera de la tabla, nombre ilegible, renglón tachado, continúa en otra foto, etc.).`;

// The answer arrives as tool input (already an object). Plain text with JSON is still accepted as a fallback.
const TOOL = {
  name: 'registrar_hoja',
  description: 'Registra el contenido leído de una hoja INGRESOS.',
  input_schema: {
    type: 'object', required: ['sheet_title', 'day_columns', 'rows'],
    properties: {
      sheet_title: { type: 'string' },
      day_columns: { type: 'array', items: { type: 'string' }, description: 'Encabezados de día tal como están impresos, en orden.' },
      rows: { type: 'array', items: { type: 'object', required: ['row_number', 'name_as_written', 'marks', 'uncertain_cells', 'note'], properties: {
        row_number: { type: ['integer', 'null'] },
        name_as_written: { type: 'string' },
        marks: { type: 'object', additionalProperties: { type: 'boolean' }, description: 'Una clave por cada valor de day_columns.' },
        uncertain_cells: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      } } },
    },
  },
};

function parseJson(input) {
  let j = input;
  if (typeof input !== 'object' || input === null) {
    let t = String(input || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('La respuesta no contiene JSON.');
    j = JSON.parse(t.slice(a, b + 1));
  }
  if (!Array.isArray(j.day_columns) || !Array.isArray(j.rows)) throw new Error('Faltan day_columns o rows.');
  j.rows = j.rows.filter(r => r && typeof r.name_as_written === 'string' && r.name_as_written.trim()).map(r => ({
    row_number: Number.isFinite(+r.row_number) && r.row_number !== null ? +r.row_number : null,
    name_as_written: r.name_as_written.trim(),
    marks: Object.fromEntries(j.day_columns.map(d => [d, !!(r.marks && r.marks[d])])),
    uncertain_cells: Array.isArray(r.uncertain_cells) ? r.uncertain_cells.filter(d => j.day_columns.includes(d)) : [],
    note: typeof r.note === 'string' ? r.note : '',
  }));
  return { sheet_title: String(j.sheet_title || ''), day_columns: j.day_columns.map(String), rows: j.rows };
}

// Phone photos are often 4–12 MB; the API takes ≤5 MB, and ~2000 px is plenty to read the marks.
async function prepareImage(file) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(fs.readFileSync(file));
  const max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toBuffer('image/jpeg', 90).toString('base64');
}

async function callClaude(b64, extra) {
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(10 * 60 * 1000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL(), max_tokens: 16000,
      tools: [TOOL], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: PROMPT + (extra || '') },
      ] }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API de Claude: ${(j.error && j.error.message) || r.status}`);
  if (j.stop_reason === 'max_tokens') throw new Error('La respuesta se cortó (hoja muy larga). Divide la foto en dos.');
  const tool = (j.content || []).find(c => c.type === 'tool_use');
  return { text: tool ? tool.input : (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), usage: j.usage || {} };
}

async function readOnce(b64) {
  try { const r = await callClaude(b64); return { ...parseJson(r.text), usage: r.usage }; }
  catch (e) {
    if (/API de Claude/.test(e.message) && !/overloaded|529|rate/i.test(e.message)) throw e;
    const r = await callClaude(b64, '\n\nIMPORTANTE: tu respuesta anterior no se pudo leer. Llama a registrar_hoja con todos los renglones.');
    return { ...parseJson(r.text), usage: r.usage, retried: true };
  }
}

const key = r => String(r.name_as_written || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

/** Combines two independent reads of the same photo: a cell is ticked only when both agree; disagreements become uncertain. */
function mergeReads(a, b) {
  const days = a.day_columns;
  const used = new Set();
  const find = r => {
    let i = b.rows.findIndex((x, k) => !used.has(k) && r.row_number != null && x.row_number === r.row_number && key(x).slice(0, 6) === key(r).slice(0, 6));
    if (i < 0) i = b.rows.findIndex((x, k) => !used.has(k) && key(x) === key(r));
    if (i >= 0) used.add(i);
    return i >= 0 ? b.rows[i] : null;
  };
  const rows = a.rows.map(r => {
    const o = find(r);
    if (!o) return { ...r, uncertain_cells: days.filter(d => r.marks[d]), note: [r.note, 'Solo una de dos lecturas encontró este renglón.'].filter(Boolean).join(' ') };
    const bd = days.length === b.day_columns.length ? Object.fromEntries(days.map((d, i) => [d, b.day_columns[i]])) : Object.fromEntries(days.map(d => [d, d]));
    const marks = {}, unc = new Set([...r.uncertain_cells, ...o.uncertain_cells.map(x => days[b.day_columns.indexOf(x)]).filter(Boolean)]);
    const differ = [];
    for (const d of days) { const x = !!r.marks[d], y = !!o.marks[bd[d]]; marks[d] = x && y; if (x !== y) { unc.add(d); differ.push(d); } }
    const note = [r.note || o.note, differ.length ? `Las dos lecturas no coinciden en: ${differ.join(', ')} (revisar con la foto).` : ''].filter(Boolean).join(' ');
    return { ...r, marks, uncertain_cells: days.filter(d => unc.has(d)), disputed_cells: differ, note };
  });
  b.rows.forEach((r, k) => { if (!used.has(k)) rows.push({ ...r, marks: Object.fromEntries(days.map(d => [d, false])), uncertain_cells: b.day_columns.filter(d => r.marks[d]).map(d => days[b.day_columns.indexOf(d)]).filter(Boolean), note: [r.note, 'Solo una de dos lecturas encontró este renglón.'].filter(Boolean).join(' ') }); });
  return { sheet_title: a.sheet_title || b.sheet_title, day_columns: days, rows };
}

/** Reads one photo twice in parallel and merges the two reads. Falls back to one read if the other fails. */
async function readSheetPhoto(file) {
  if (!hasKey()) throw new Error('Falta la variable ANTHROPIC_API_KEY en Render.');
  const b64 = await prepareImage(file);
  const [x, y] = await Promise.allSettled([readOnce(b64), readOnce(b64)]);
  if (x.status === 'rejected' && y.status === 'rejected') throw x.reason;
  const ok = [x, y].filter(p => p.status === 'fulfilled').map(p => p.value);
  const usage = ok.reduce((u, r) => ({ input_tokens: u.input_tokens + (r.usage.input_tokens || 0), output_tokens: u.output_tokens + (r.usage.output_tokens || 0) }), { input_tokens: 0, output_tokens: 0 });
  if (ok.length === 1) {
    const why = [x, y].find(p => p.status === 'rejected').reason;
    console.error('Comidas: one of two reads failed:', why && why.message);
    return { ...ok[0], usage, single: true, warning: `Solo se pudo hacer una lectura (${why && why.message}); revisa esta foto con más cuidado.` };
  }
  return { ...mergeReads(ok[0], ok[1]), usage, retried: ok.some(r => r.retried) };
}

module.exports = { readSheetPhoto, mergeReads, parseJson, hasKey, MODEL, PROMPT };
