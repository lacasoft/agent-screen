// Ejecuta una tarea contra la API local como lo haría el evaluador (poll cada 5 s).
// Uso: node spikes/run-task.mjs "<instrucción>" [puerto]
// Lee AGENT_API_TOKEN, DESKTOP_URL y DESKTOP_PASSWORD de .env (no imprime ninguno).
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = { ...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env };
const [instruction, port = '3000'] = process.argv.slice(2);
if (!instruction) throw new Error('Falta la instrucción');
const base = `http://localhost:${port}`;
const auth = { Authorization: `Bearer ${env.AGENT_API_TOKEN}` };

const t0 = performance.now();
const s = () => ((performance.now() - t0) / 1000).toFixed(1);
const res = await fetch(`${base}/tasks`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tarea: instruction, escritorio: { url: env.DESKTOP_URL, password: env.DESKTOP_PASSWORD } }),
});
const created = await res.json();
console.log(`[${s()} s] POST /tasks → ${res.status} ${JSON.stringify(created)}`);
if (!res.ok) process.exit(1);

for (;;) {
  await new Promise((r) => setTimeout(r, 5_000));
  const st = await (await fetch(`${base}/tasks/${created.task_id}`, { headers: auth })).json();
  if (st.estado !== 'en_curso') {
    console.log(`[${s()} s] ${st.estado}\n--- resumen ---\n${st.resumen}`);
    const pw = env.DESKTOP_PASSWORD ?? '';
    console.log(`(¿contraseña en el resumen? ${pw && st.resumen.includes(pw) ? 'SÍ ⚠' : 'no'})`);
    break;
  }
  if (performance.now() - t0 > 330_000) {
    console.log(`[${s()} s] sigue en_curso pasados 330 s ⚠`);
    break;
  }
}
