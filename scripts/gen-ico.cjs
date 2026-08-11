const fs = require('fs');

// Generate a proper Windows 3.00 format ICO file with BMP-encoded icons
// (PNG-in-ICO is not supported by RC.EXE for resource compilation).
function makeIco(sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + sizes.length * 16;

  for (const size of sizes) {
    // BITMAPINFOHEADER (40 bytes)
    const bih = Buffer.alloc(40);
    bih.writeUInt32LE(40, 0);         // biSize
    bih.writeInt32LE(size, 4);         // biWidth
    bih.writeInt32LE(size * 2, 8);     // biHeight (2x for XOR+AND masks)
    bih.writeUInt16LE(1, 12);          // biPlanes
    bih.writeUInt16LE(32, 14);         // biBitCount
    // rest of BITMAPINFOHEADER is zeros (BI_RGB, no compression)

    // XOR mask: 32-bit BGRA pixels, bottom-up, padded to 4-byte alignment
    const rowPadded = size * 4; // 32-bit = 4 bytes/pixel, already aligned
    const xorSize = rowPadded * size;
    const xor = Buffer.alloc(xorSize);

    // AND mask: 1 bit per pixel, padded to 4-byte rows
    const andRowPadded = Math.ceil(size / 32) * 4;
    const andSize = andRowPadded * size;
    const andMask = Buffer.alloc(andSize); // all zeros = fully opaque

    // Fill XOR mask with a solid dark color (BGRA, bottom-up)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Simple "AW" letter shape: draw a white-ish block in center
        const cx = size / 2;
        const cy = size / 2;
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const inCircle = d < size * 0.35;
        if (inCircle) {
          const o = y * rowPadded + x * 4;
          xor[o] = 31;     // B
          xor[o + 1] = 111; // G
          xor[o + 2] = 235; // R
          xor[o + 3] = 255; // A
        } else {
          const o = y * rowPadded + x * 4;
          xor[o] = 14;     // B
          xor[o + 1] = 17; // G
          xor[o + 2] = 22; // R
          xor[o + 3] = 255; // A
        }
      }
    }

    const data = Buffer.concat([bih, xor, andMask]);

    // Directory entry (16 bytes)
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;  // width
    entry[1] = size === 256 ? 0 : size;  // height
    entry[2] = 0;                          // color count (0 = 256+)
    entry[3] = 0;                          // reserved
    entry.writeUInt16LE(1, 4);             // planes
    entry.writeUInt16LE(32, 6);            // bit count
    entry.writeUInt32LE(data.length, 8);   // bytes in resource
    entry.writeUInt32LE(offset, 12);       // offset

    entries.push(entry);
    datas.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...datas]);
}

const dir = 'C:/aw-icons';
fs.writeFileSync(dir + '/icon.ico', makeIco([16, 32, 48, 64, 128, 256]));
console.log('ICO written:', fs.statSync(dir + '/icon.ico').size, 'bytes');
