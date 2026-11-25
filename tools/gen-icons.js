// Генерация PNG-иконок приложения (тёмный фон + гантель), без зависимостей
// Запуск: node tools/gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---- минимальный PNG-энкодер ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function pngEncode(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // фильтр none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- рисование ---- */
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const BG = hex('#101216');
const PLATE = hex('#ff6b35');   // блины
const PLATE2 = hex('#e85a26');  // малые блины
const BAR = hex('#e8eaef');     // гриф

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const put = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  const S = size / 100; // нормализация координат
  const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + r, Math.min(x, x1 - r));
    const cy = Math.max(y0 + r, Math.min(y, y1 - r));
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / S, ny = y / S; // 0..100
      let c = BG;
      // гриф
      if (nx >= 30 && nx <= 70 && ny >= 46 && ny <= 54) c = BAR;
      // большие блины
      if (inRoundedRect(nx, ny, 16, 26, 30, 74, 4)) c = PLATE;
      if (inRoundedRect(nx, ny, 70, 26, 84, 74, 4)) c = PLATE;
      // малые блины
      if (inRoundedRect(nx, ny, 30, 36, 38, 64, 3)) c = PLATE2;
      if (inRoundedRect(nx, ny, 62, 36, 70, 64, 3)) c = PLATE2;
      put(x, y, c);
    }
  }
  return pngEncode(size, size, Buffer.from(px));
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of [512, 192, 180]) {
  fs.writeFileSync(path.join(outDir, `icon-${s}.png`), drawIcon(s));
  console.log(`icon-${s}.png готова`);
}
