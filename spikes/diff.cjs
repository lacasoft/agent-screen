// Diagnóstico del spike: compara spikes/out/before.png y after.png y da la caja de píxeles distintos.
const { PNG } = require('pngjs');
const fs = require('fs');
const a = PNG.sync.read(fs.readFileSync(`${__dirname}/out/before.png`));
const b = PNG.sync.read(fs.readFileSync(`${__dirname}/out/after.png`));
let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
  const i = (y * a.width + x) * 4;
  if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
    n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
}
console.log(n ? `${n} px distintos · caja (${x0},${y0})–(${x1},${y1})` : 'sin diferencias');
