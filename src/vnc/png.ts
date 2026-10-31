import { crc32, deflateSync } from 'node:zlib';
import type { Frame } from './frame';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Codifica un Frame RGBA como PNG RGB de 8 bits (el alfa del framebuffer es siempre opaco). */
export function encodePng(frame: Frame): Buffer {
  const { width, height, rgba } = frame;
  const stride = width * 3 + 1; // byte de filtro (0 = None) + RGB
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    let o = y * stride + 1;
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // color RGB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG como data URL para la API del modelo. */
export function toPngDataUrl(frame: Frame): string {
  return `data:image/png;base64,${encodePng(frame).toString('base64')}`;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
