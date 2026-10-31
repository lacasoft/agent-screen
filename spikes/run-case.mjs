// Ejecuta un caso de práctica de punta a punta como el evaluador:
//   __reset → POST /tasks → poll cada 5 s → __check con el JSON oficial → criterios del agente.
// Uso: node spikes/run-case.mjs e1-e5/E1-crear-cliente.json [puerto]
// Lee AGENT_API_TOKEN, DESKTOP_URL, DESKTOP_PASSWORD y DESKTOP_TOKEN de .env (no imprime ninguno).
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = { ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
const [file, port = '3000'] = process.argv.slice(2);
const kase = JSON.parse(readFileSync(file, 'utf8'));
const api = `http://localhost:${port}`;
const desk = new URL(env.DESKTOP_URL);
desk.protocol = 'https:';
const deskBase = `${desk.protocol}//${desk.host}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reset = await fetch(`${deskBase}/__reset`, { method: 'POST', headers: { Authorization: `Bearer ${env.DESKTOP_TOKEN}` } });
console.log(`[${kase.id}] __reset → ${reset.status}`);
await sleep(8_000); // el navegador del escritorio se reinicia

const t0 = performance.now();
const auth = { Authorization: `Bearer ${env.AGENT_API_TOKEN}` };
const res = await fetch(`${api}/tasks`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tarea: kase.instruccion, escritorio: { url: env.DESKTOP_URL, password: env.DESKTOP_PASSWORD } }),
});
const postMs = Math.round(performance.now() - t0);
const { task_id } = await res.json();
console.log(`[${kase.id}] POST /tasks → ${res.status} en ${postMs} ms · ${task_id}`);

let st;
for (;;) {
  await sleep(5_000);
  st = await (await fetch(`${api}/tasks/${task_id}`, { headers: auth })).json();
  if (st.estado !== 'en_curso' || performance.now() - t0 > 330_000) break;
}
const secs = ((performance.now() - t0) / 1000).toFixed(1);

const check = await fetch(`${deskBase}/__check`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.DESKTOP_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(kase),
});
const checkBody = await check.text();

// Criterios del lado del agente (brief §6).
const resumen = st.resumen ?? '';
const lines = resumen.split('\n').filter((l) => /^\s*respuesta\s*:/i.test(l));
const crit = { estado: st.estado === kase.estado_esperado };
if (kase.respuesta_esperada !== undefined) {
  const first = lines[0]?.match(/-?\d+(?:[.,]\d+)?/)?.[0];
  crit.una_linea_respuesta = lines.length === 1;
  crit.respuesta = first === String(kase.respuesta_esperada);
}
if (kase.claves_razon) crit.claves_razon = kase.claves_razon.every((k) => resumen.includes(k));
if (kase.estado_esperado === 'fallida') crit.sin_linea_respuesta = lines.length === 0;
crit.sin_contraseña = !(env.DESKTOP_PASSWORD && resumen.includes(env.DESKTOP_PASSWORD));
crit.post_menor_2s = postMs < 2_000;
crit.dentro_de_300s = Number(secs) < 300;

console.log(`[${kase.id}] ${st.estado} en ${secs} s (esperado: ${kase.estado_esperado})`);
console.log(`--- resumen ---\n${resumen}\n---------------`);
console.log(`[${kase.id}] __check → ${check.status} ${checkBody.slice(0, 1500)}`);
const failed = Object.entries(crit).filter(([, ok]) => !ok).map(([k]) => k);
console.log(`[${kase.id}] criterios del agente: ${failed.length ? `FALLAN ${failed.join(', ')}` : 'todos OK'} ${JSON.stringify(crit)}`);
