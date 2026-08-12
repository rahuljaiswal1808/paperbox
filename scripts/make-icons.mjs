/**
 * Generates the PWA icons procedurally so the repository carries no binary blobs
 * that cannot be regenerated. Draws a rounded "document" mark on a dark ground.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundedRect = (x, y, rx, ry, w, h, r) => {
  const dx = Math.max(rx - x, 0, x - (rx + w));
  const dy = Math.max(ry - y, 0, y - (ry + h));
  if (dx === 0 && dy === 0) return true;
  return Math.hypot(Math.max(dx - 0, 0), Math.max(dy - 0, 0)) <= r && x >= rx - r && x <= rx + w + r;
};

function drawIcon(size) {
  const data = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const put = (x, y, [r, g, b, a]) => {
    const i = (y * size + x) * 4;
    const alpha = a / 255;
    data[i] = Math.round(data[i] * (1 - alpha) + r * alpha);
    data[i + 1] = Math.round(data[i + 1] * (1 - alpha) + g * alpha);
    data[i + 2] = Math.round(data[i + 2] * (1 - alpha) + b * alpha);
    data[i + 3] = Math.max(data[i + 3], a);
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // background
      if (inRoundedRect(x, y, 0, 0, size - 1, size - 1, 96 * s)) put(x, y, [14, 17, 22, 255]);
      // page
      const px = 150 * s;
      const py = 104 * s;
      const pw = 212 * s;
      const ph = 304 * s;
      if (x >= px && x <= px + pw && y >= py && y <= py + ph) put(x, y, [244, 246, 250, 255]);
      // folded corner
      if (x >= px + pw - 70 * s && x <= px + pw && y >= py && y <= py + 70 * s && x - (px + pw - 70 * s) > y - py) {
        put(x, y, [14, 17, 22, 255]);
      }
      // accent lines
      for (const [ly, lw] of [[190, 150], [232, 150], [274, 96]]) {
        if (y >= (ly) * s && y <= (ly + 18) * s && x >= 180 * s && x <= (180 + lw) * s) {
          put(x, y, [47, 109, 246, 255]);
        }
      }
    }
  }
  return data;
}

mkdirSync(join(root, 'public'), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(root, 'public', `icon-${size}.png`), png(size, size, drawIcon(size)));
}
console.log('[icons] wrote public/icon-192.png and public/icon-512.png');
