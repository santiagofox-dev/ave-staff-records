'use strict';
/* ASISTENTE ASISTENCIA — reads one photo of the printed LISTA DE ASISTENCIA with the Claude API.
   Two independent reads are merged; any cell where they disagree is marked as doubtful. */
const fs = require('fs');
const { normName } = require('./meals-core');
const { DAYS } = require('./asistencia-core');

const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const hasKey = () => !!process.env.ANTHROPIC_API_KEY;

const PROMPT = `Eres un lector de listas de asistencia de un comedor industrial (Grupo AVE). La foto muestra una hoja impresa "LISTA DE ASISTENCIA" con un recuadro "CÓDIGO DE HOJA" arriba a la derecha (ej. MVA-T1-261116-1/2), columnas ID, NOMBRE (impresos), una columna por día (Lun a Sáb) dividida en dos cuadros "Clave" y "TE", y una columna FIRMA.

Registra la hoja llamando a la herramienta "registrar_lista" una sola vez, con todos los renglones.

Reglas:
- "sheet_code": copia exactamente el código impreso del recuadro.
- Los ID y nombres impresos ya los conoces (abajo). Para cada renglón impreso devuelve su ID impreso tal cual; no lo corrijas.
- Clave: deja "" si el cuadro está vacío. Si tiene letras, devuelve lo escrito: FI, INC, VAC o PSS. Si está escrito "F" sola, devuelve "FI". Si es otra cosa, cópiala tal cual.
- Ignora palomitas, puntos, rayas o diagonales sueltas en el cuadro Clave: eso cuenta como vacío ("").
- Una "O" o un guion largo "—" repetido a lo largo de varios días en el mismo renglón significa incapacidad: devuelve "INC" en esos días y explícalo en "note".
- TE: devuelve solo el número de horas escrito (ej. 2, 1.5, 0.5). Si está vacío devuelve null. Si hay un número tachado y otro al lado, usa el que NO está tachado y agrega el día a "uncertain".
- Si hay un número escrito en el cuadro Clave (en lugar del cuadro TE), tómalo como TE de ese día y agrega el día a "uncertain".
- Los días sombreados con la palabra "descanso" solo tienen abierto el cuadro TE.
- Renglones agregados a mano al final ("Nuevo: escribe ID y nombre"): devuélvelos con el ID y el nombre que estén escritos (id null si no hay número).
- La foto puede estar inclinada: asigna cada marca al renglón siguiendo las líneas impresas de la cuadrícula, no a simple vista.
- "uncertain": días (lun, mar, mie, jue, vie, sab) de ese renglón cuya lectura no es clara.
- "signed": true si el colaborador firmó en su renglón.
- "manager_signed": true si hay firma o nombre en "Revisó (gerente)".
- "note": vacío "" salvo que haya algo que el revisor deba saber.`;

const DAY_SCHEMA = { type: 'object', required: ['clave', 'te'], properties: { clave: { type: 'string' }, te: { type: ['number', 'null'] } } };
const TOOL = {
  name: 'registrar_lista',
  description: 'Registra el contenido leído de una LISTA DE ASISTENCIA.',
  input_schema: {
    type: 'object', required: ['sheet_code', 'rows', 'manager_signed'],
    properties: {
      sheet_code: { type: 'string' },
      manager_signed: { type: 'boolean' },
      rows: { type: 'array', items: { type: 'object', required: ['id', 'name', 'days', 'uncertain', 'signed', 'note'], properties: {
        id: { type: ['string', 'null'] }, name: { type: 'string' }, handwritten: { type: 'boolean', description: 'true si el renglón fue agregado a mano' },
        days: { type: 'object', required: DAYS, properties: Object.fromEntries(DAYS.map(d => [d, DAY_SCHEMA])) },
        uncertain: { type: 'array', items: { type: 'string', enum: DAYS } }, signed: { type: 'boolean' }, note: { type: 'string' },
      } } },
    },
  },
};

function clean(j) {
  if (!j || !Array.isArray(j.rows)) throw new Error('La lectura no trae renglones.');
  return {
    sheet_code: String(j.sheet_code || '').trim().toUpperCase().replace(/\s+/g, ''), manager_signed: !!j.manager_signed,
    rows: j.rows.filter(r => r && (r.id || r.name)).map(r => ({
      id: r.id == null || r.id === '' ? null : String(r.id).replace(/\s/g, ''), name: String(r.name || '').trim().toUpperCase(), handwritten: !!r.handwritten,
      days: Object.fromEntries(DAYS.map(d => { const x = (r.days || {})[d] || {}; return [d, { clave: String(x.clave || '').trim().toUpperCase(), te: Number.isFinite(+x.te) && x.te !== null && x.te !== '' ? +x.te : null }]; })),
      uncertain: (r.uncertain || []).filter(d => DAYS.includes(d)), signed: !!r.signed, note: String(r.note || ''),
    })),
  };
}

async function prepareImage(file) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(fs.readFileSync(file));
  const k = Math.min(1, 2400 / Math.max(img.width, img.height));
  const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let q = 88, buf = c.toBuffer('image/jpeg', q);
  while (buf.length > 4.5e6 && q > 50) { q -= 12; buf = c.toBuffer('image/jpeg', q); }
  return buf.toString('base64');
}

async function callClaude(b64, context) {
  const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(10 * 60 * 1000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 16000, tools: [TOOL], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: PROMPT + context }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API de Claude: ${(j.error && j.error.message) || r.status}`);
  if (j.stop_reason === 'max_tokens') throw new Error('La respuesta se cortó; toma la foto de una hoja a la vez.');
  const tool = (j.content || []).find(c => c.type === 'tool_use');
  if (tool) return { ...clean(tool.input), usage: j.usage || {} };
  // fallback: JSON written as text
  const t = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('La lectura no regresó datos.');
  return { ...clean(JSON.parse(t.slice(a, b + 1))), usage: j.usage || {} };
}

const keyOf = r => r.id ? 'id:' + String(r.id).replace(/^0+(?=\d)/, '') : 'n:' + normName(r.name);
/** Merge two reads: equal cells pass; any disagreement keeps read A's value and marks the day doubtful. */
function mergeReads(a, b) {
  const bm = new Map(b.rows.map(r => [keyOf(r), r]));
  const rows = a.rows.map(r => {
    const o = bm.get(keyOf(r)); bm.delete(keyOf(r));
    if (!o) return { ...r, uncertain: DAYS.filter(d => r.days[d].clave || r.days[d].te), note: [r.note, 'Solo una de dos lecturas encontró este renglón.'].filter(Boolean).join(' ') };
    const unc = new Set([...r.uncertain, ...o.uncertain]), differ = [];
    for (const d of DAYS) {
      const x = r.days[d], y = o.days[d];
      if (x.clave !== y.clave || (x.te || 0) !== (y.te || 0)) { unc.add(d); differ.push(`${d}: ${x.clave || '·'}/${x.te ?? '·'} vs ${y.clave || '·'}/${y.te ?? '·'}`); }
    }
    return { ...r, uncertain: DAYS.filter(d => unc.has(d)), note: [r.note || o.note, differ.length ? `Las dos lecturas no coinciden (${differ.join('; ')}).` : ''].filter(Boolean).join(' ') };
  });
  for (const r of bm.values()) rows.push({ ...r, uncertain: DAYS.filter(d => r.days[d].clave || r.days[d].te), note: [r.note, 'Solo una de dos lecturas encontró este renglón.'].filter(Boolean).join(' ') });
  return { sheet_code: a.sheet_code || b.sheet_code, codeDiffers: a.sheet_code !== b.sheet_code, manager_signed: a.manager_signed || b.manager_signed, rows };
}

/** sheets: the printed layout for the week, used as context so the reader knows the printed IDs and names. */
async function readAttendancePhoto(file, sheets) {
  if (!hasKey()) throw new Error('Falta la variable ANTHROPIC_API_KEY en Render.');
  const b64 = await prepareImage(file);
  const ctx = sheets && sheets.length ? '\n\nHojas impresas esta semana (código → renglones "ID NOMBRE"):\n' + sheets.map(s => `${s.code} (${s.turno}):\n` + s.rows.map(r => `  ${r.id} ${r.name}`).join('\n')).join('\n') : '';
  ctx += '\n\nIMPORTANTE: responde únicamente llamando a la herramienta registrar_lista.';
  const once = () => callClaude(b64, ctx).catch(e => { if (/overloaded|529|rate|no regresó/i.test(e.message)) return callClaude(b64, ctx); throw e; });
  const [x, y] = await Promise.allSettled([once(), once()]);
  if (x.status === 'rejected' && y.status === 'rejected') throw x.reason;
  const ok = [x, y].filter(p => p.status === 'fulfilled').map(p => p.value);
  const usage = ok.reduce((u, r) => ({ input_tokens: u.input_tokens + (r.usage.input_tokens || 0), output_tokens: u.output_tokens + (r.usage.output_tokens || 0) }), { input_tokens: 0, output_tokens: 0 });
  if (ok.length === 1) return { ...ok[0], rows: ok[0].rows.map(r => ({ ...r, uncertain: DAYS.filter(d => r.days[d].clave || r.days[d].te || r.uncertain.includes(d)) })), usage, warning: 'Solo se pudo hacer una lectura; revisa esta foto con más cuidado.' };
  return { ...mergeReads(ok[0], ok[1]), usage };
}

module.exports = { readAttendancePhoto, mergeReads, clean, hasKey, MODEL, PROMPT };
