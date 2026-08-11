const fs = require('fs');
const { deflateSync } = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * row + 1 + x * 4;
      raw[o] = 14; raw[o + 1] = 17; raw[o + 2] = 22; raw[o + 3] = 255;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  const datas = [];
  let offset = 6 + sizes.length * 16;
  for (const s of sizes) {
    const pngBuf = png(s);
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(offset, 8);
    e.writeUInt32LE(pngBuf.length, 12);
    entries.push(e);
    datas.push(pngBuf);
    offset += pngBuf.length;
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

const dir = 'C:/Users/hiyad/Desktop/26暑/attention-wallpaper/src-tauri/icons';
fs.writeFileSync(dir + '/32x32.png', png(32));
fs.writeFileSync(dir + '/128x128.png', png(128));
fs.writeFileSync(dir + '/128x128@2x.png', png(256));
fs.writeFileSync(dir + '/icon.png', png(256));
fs.writeFileSync(dir + '/icon.ico', ico([16, 32, 48, 64, 128, 256]));
console.log('icons written');
