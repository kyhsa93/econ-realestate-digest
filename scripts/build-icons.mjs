// 앱 아이콘을 그린다. 그림 파일이 아니라 코드다.
//
// 이름이 '집계'고, 마크는 그 이름을 그대로 그린 것이다 - 넉 대에 가로지르는
// 한 대, 다섯을 세는 획. 화면의 워드마크(style.css의 .wordmark::before)는 같은
// 모양을 CSS 그러데이션으로 그리므로, 둘 중 하나를 고치면 다른 하나도 고쳐야 한다.
//
// 마스커블 아이콘이라 바탕은 모서리까지 꽉 채우고 획은 가운데 80% 안에 둔다.
// 런처가 원이나 둥근 사각으로 잘라내도 획이 안 잘리는 범위다.
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const BG = [0x25, 0x3e, 0x81];
const FG = [0xff, 0xff, 0xff];
const SS = 4; // 계단을 없애려고 네 배로 그린 뒤 줄인다.

// 512 기준 좌표. 가운데 256×160 안에 획이 다 들어간다.
const BARS = 4;
const BAR_W = 26;
const BOX = { x: 128, y: 176, w: 256, h: 160 };
const CROSS = { x1: 116, y1: 340, x2: 396, y2: 172, w: 26 };

const dist = (px, py, { x1, y1, x2, y2 }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

function coverage(x, y, scale) {
  // 좌표는 512 기준으로 되돌려 본다. 크기가 달라도 같은 그림이 나온다.
  const px = x / scale;
  const py = y / scale;
  const gap = BARS > 1 ? (BOX.w - BAR_W) / (BARS - 1) : 0;
  for (let i = 0; i < BARS; i += 1) {
    const left = BOX.x + i * gap;
    if (px >= left && px <= left + BAR_W && py >= BOX.y && py <= BOX.y + BOX.h) return true;
  }
  return dist(px, py, CROSS) <= CROSS.w / 2;
}

function render(size) {
  // 512 기준 좌표를 실제 크기·초과표본에 맞춰 늘리는 배율.
  const scale = (size * SS) / 512;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(size * 4 + 1);
    row[0] = 0; // 필터 없음 - 크기가 작아 굳이 고를 이유가 없다.
    for (let x = 0; x < size; x += 1) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          if (coverage(x * SS + sx + 0.5, y * SS + sy + 0.5, scale)) hit += 1;
        }
      }
      const a = hit / (SS * SS);
      const at = 1 + x * 4;
      for (let c = 0; c < 3; c += 1) row[at + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
      row[at + 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

const chunk = (type, data) => {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), data])), data.length + 8);
  return out;
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) | 0;
}

export function icon(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 채널당 8비트
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(render(size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && process.argv[1].endsWith("build-icons.mjs")) {
  const dir = path.resolve(import.meta.dirname, "../docs/icons");
  for (const size of [192, 512]) {
    await writeFile(path.join(dir, `icon-${size}.png`), icon(size));
    console.log(`  docs/icons/icon-${size}.png 갱신`);
  }
}
