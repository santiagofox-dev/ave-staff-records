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
- MARCAS FUERA DE LA TABLA: es frecuente que el último día (la columna de la derecha) se haya marcado con una serie de diagonales o palomitas de lápiz que caen a la derecha del borde de la tabla, una por renglón, a lo largo de casi toda la hoja. Recorre esa franja de arriba abajo, renglón por renglón, siguiendo la inclinación de las líneas impresas hasta el borde: cada trazo cuenta como true para el último día del renglón cuya línea continúa. No te detengas a la mitad de la hoja; cuenta los trazos y verifica que asignaste el mismo número de renglones.
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

/** Reads one photo. Retries once if the JSON doesn't parse. */
async function readSheetPhoto(file) {
  if (!hasKey()) throw new Error('Falta la variable ANTHROPIC_API_KEY en Render.');
  const b64 = await prepareImage(file);
  let first;
  try { first = await callClaude(b64); return { ...parseJson(first.text), usage: first.usage }; }
  catch (e) {
    if (/API de Claude/.test(e.message) && !/overloaded|529|rate/i.test(e.message)) throw e;
    const second = await callClaude(b64, '\n\nIMPORTANTE: tu respuesta anterior no se pudo leer. Llama a registrar_hoja con todos los renglones.');
    return { ...parseJson(second.text), usage: second.usage, retried: true };
  }
}

module.exports = { readSheetPhoto, parseJson, hasKey, MODEL, PROMPT };
