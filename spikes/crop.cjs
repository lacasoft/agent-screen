// Diagnóstico: node spikes/crop.cjs <before|after> x y w h  → spikes/out/crop.png
const { PNG } = require('pngjs');
const fs = require('fs');
const [name, x, y, w, h] = process.argv.slice(2);
const [X, Y, W, H] = [x, y, w, h].map(Number);
const a = PNG.sync.read(fs.readFileSync(`${__dirname}/out/${name}.png`));
const o = new PNG({ width: W, height: H });
for (let j = 0; j < H; j++) a.data.copy(o.data, j * W * 4, ((Y + j) * a.width + X) * 4, ((Y + j) * a.width + X + W) * 4);
fs.writeFileSync(`${__dirname}/out/crop.png`, PNG.sync.write(o));
console.log(`crop ${name} (${X},${Y}) ${W}×${H}`);
