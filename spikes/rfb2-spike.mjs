// Spike ADR-0002: validar rfb2 sobre wss://…/websockify. NO es código de producción.
//
// Uso (credenciales SOLO por env o .env; nunca por argumento ni en el código):
//   DESKTOP_URL, DESKTOP_PASSWORD y DESKTOP_TOKEN en .env (ver .env.example); se carga solo.
//   node spikes/rfb2-spike.mjs observe                 # solo lectura: conecta, captura y cierra
//   node spikes/rfb2-spike.mjs input <x> <y> [texto]   # clic de 150 ms + Ctrl+A + texto (sin Enter)
//   node spikes/rfb2-spike.mjs reset                   # POST /__reset del escritorio de práctica
//
// Salida: spikes/out/{before,after}.png (1280×800) y *-half.png (a la mitad, para revisarlas barato).
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { connect, Framebuffer, keysyms, keysymFromChar } from 'rfb2';
import WebSocket, { createWebSocketStream } from 'ws';

const HARD_LIMIT_MS = 30_000; // watchdog del spike: pase lo que pase, corta y sale
const CLICK_MS = 150;
const REPAINT_MS = 1_200;
const OUT = new URL('./out/', import.meta.url);

try {
  process.loadEnvFile(new URL('../.env', import.meta.url)); // no pisa variables ya exportadas
} catch {
  // sin .env: se usan las variables del entorno
}

const url = process.env.DESKTOP_URL;
const password = process.env.DESKTOP_PASSWORD;
const [mode = 'observe', xs, ys, text = 'spike123'] = process.argv.slice(2);
if (!['observe', 'input', 'move', 'reset'].includes(mode)) fail('Modo: observe | move <x> <y> | input <x> <y> [texto] | reset');
if (!url?.startsWith('wss://')) fail('Falta DESKTOP_URL (wss://…/websockify) en .env');
if (mode === 'reset') await reset();
if (!password) fail('Falta DESKTOP_PASSWORD en .env');

const t0 = performance.now();
const ms = () => `${Math.round(performance.now() - t0)} ms`;
const log = (m) => console.log(`[${ms()}] ${m}`);
let ws, client;

const watchdog = setTimeout(() => {
  log(`WATCHDOG ${HARD_LIMIT_MS} ms: destruyo el socket`);
  client?.destroy();
  ws?.terminate();
  process.exit(2);
}, HARD_LIMIT_MS);

try {
  ws = new WebSocket(url, ['binary'], { handshakeTimeout: 10_000 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  log(`WebSocket abierto (subprotocolo: ${ws.protocol || 'ninguno'})`);

  client = await connect({ stream: createWebSocketStream(ws), password, timeout: 10_000, shared: true });
  log(`RFB ${client.protocolVersion} · seguridad ${client.securityType} · ${client.width}×${client.height} · "${client.name}"`);
  client.on('error', (e) => log(`error RFB: ${e.code ?? ''} ${e.message}`));

  const fb = Framebuffer.attach(client);
  await capture(fb, 'before');

  if (mode === 'move') {
    // Solo mover el puntero (sin botones): diagnóstico de si el servidor acepta entrada.
    const x = Number(xs), y = Number(ys);
    for (let i = 0; i <= 10; i++) {
      client.pointerEvent(Math.round(x * i / 10), Math.round(y * i / 10), 0);
      await sleep(20);
    }
    log(`puntero movido a (${x},${y}) · ws.bufferedAmount=${ws.bufferedAmount}`);
    await sleep(REPAINT_MS);
    await capture(fb, 'after');
  }

  if (mode === 'input') {
    const x = Number(xs), y = Number(ys);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= client.width || y >= client.height) {
      throw new Error(`Coordenadas fuera de pantalla (${client.width}×${client.height})`);
    }
    client.pointerEvent(x, y, 0); // mover
    await sleep(50);
    client.pointerEvent(x, y, 1); // izquierdo abajo
    await sleep(CLICK_MS);
    client.pointerEvent(x, y, 0); // arriba
    log(`clic ${CLICK_MS} ms en (${x},${y})`);
    await sleep(REPAINT_MS);

    await keyCombo(keysyms.ControlLeft, keysymFromChar('a'));
    log('Ctrl+A');
    for (const ch of text) {
      await tap(keysymFromChar(ch));
    }
    log(`tecleado "${text}" (${text.length} car.), SIN Enter`);
    await measureRepaint(fb);
    await capture(fb, 'after');
  }
} catch (e) {
  log(`FALLO: ${e?.code ?? e?.name ?? ''} ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await closeAll();
  log('cerrado');
}

// Captura cada 250 ms tras la acción y registra cuándo cambia la pantalla y cuándo se estabiliza.
async function measureRepaint(fb) {
  const tAction = performance.now();
  let prev = Buffer.from(fb.toRgba()), changedAt = null, stableSince = null;
  while (performance.now() - tAction < 8_000) {
    await sleep(250);
    const p = client.nextUpdate();
    client.requestUpdate(false);
    await Promise.race([p, sleep(2_000)]);
    const cur = Buffer.from(fb.toRgba());
    const same = cur.equals(prev);
    const t = Math.round(performance.now() - tAction);
    if (!same) { changedAt ??= t; stableSince = null; log(`  +${t} ms: cambia ${bbox(prev, cur, fb.width)}`); }
    else if (changedAt !== null) { stableSince ??= t; if (t - stableSince >= 1_200) break; }
    prev = cur;
  }
  log(`repintado: primer cambio a +${changedAt ?? '—'} ms; estable desde +${stableSince ?? '—'} ms`);
}

function bbox(a, b, w) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      const p = i >> 2, x = p % w, y = (p / w) | 0;
      n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return `${n} px en (${x0},${y0})–(${x1},${y1})`;
}

async function capture(fb, name) {
  // Algunas updates solo traen pseudo-rects (p. ej. extendedDesktopSize): se espera a una con píxeles.
  const deadline = performance.now() + 5_000;
  const kinds = {};
  let gotPixels = false, n = 0;
  while (!gotPixels) {
    const left = deadline - performance.now();
    if (left <= 0) throw new Error('sin píxeles en 5 s');
    const p = client.nextUpdate();
    client.requestUpdate(false); // no incremental: pantalla completa
    const update = await Promise.race([p, sleep(left).then(() => { throw new Error('sin píxeles en 5 s'); })]);
    n++;
    for (const r of update.rects) {
      kinds[`${r.type}/${r.encoding}`] = (kinds[`${r.type}/${r.encoding}`] ?? 0) + 1;
      if (r.type === 'pixels' || r.type === 'copy') gotPixels = true;
    }
  }
  const update = { rects: { length: Object.values(kinds).reduce((x, y) => x + y, 0) } };
  const rgba = Buffer.from(fb.toRgba());
  let lit = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] | rgba[i + 1] | rgba[i + 2]) lit++;
  log(`${n} updates, ${update.rects.length} rects ${JSON.stringify(kinds)} · píxeles no negros ${((100 * lit) / (rgba.length / 4)).toFixed(1)} %`);
  mkdirSync(OUT, { recursive: true });
  writePng(new URL(`${name}.png`, OUT), fb.width, fb.height, rgba);
  writePng(new URL(`${name}-half.png`, OUT), fb.width >> 1, fb.height >> 1, half(rgba, fb.width, fb.height));
  log(`captura "${name}" ${fb.width}×${fb.height} → spikes/out/${name}.png`);
}

function half(src, w, h) {
  const hw = w >> 1, hh = h >> 1, dst = Buffer.alloc(hw * hh * 4);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    src.copy(dst, (y * hw + x) * 4, ((2 * y) * w + 2 * x) * 4, ((2 * y) * w + 2 * x) * 4 + 4);
  }
  return dst;
}

function writePng(file, width, height, data) {
  const png = new PNG({ width, height });
  data.copy(png.data);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255; // opaco
  writeFileSync(file, PNG.sync.write(png));
}

async function tap(k) {
  client.keyEvent(k, true);
  await sleep(30);
  client.keyEvent(k, false);
  await sleep(30);
}

async function keyCombo(mod, k) {
  client.keyEvent(mod, true);
  await sleep(30);
  await tap(k);
  client.keyEvent(mod, false);
  await sleep(30);
}

async function closeAll() {
  if (!client) return ws?.terminate();
  await Promise.race([client.close().catch(() => {}), sleep(2_000)]);
  client.destroy();
  ws?.terminate();
}

async function reset() {
  const token = process.env.DESKTOP_TOKEN;
  if (!token) fail('Falta DESKTOP_TOKEN en .env');
  const base = new URL(url);
  base.protocol = 'https:';
  base.pathname = '/__reset';
  const res = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`POST /__reset → ${res.status}`); // no se imprime el cuerpo ni el token
  process.exit(res.ok ? 0 : 1);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
