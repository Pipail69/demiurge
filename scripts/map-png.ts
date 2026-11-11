/**
 * Outil de vérification visuelle : génère un monde et écrit le PNG du MÊME tampon RGBA que la
 * page (src/render/palette.ts). Node pur ; node:zlib pour la compression.
 * Usage : node scripts/map-png.ts <graine> <largeur> <hauteur> <fichier.png>
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateWorld, hashWorld, World } from '../src/core/index.ts';
import { worldToRgba } from '../src/render/palette.ts';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode un tampon RGBA (W·H·4) en PNG 8 bits RGBA, filtre 0 sur chaque ligne. */
export function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const [seedArg, wArg, hArg, out] = process.argv.slice(2);
if (seedArg === undefined || wArg === undefined || hArg === undefined || out === undefined) {
  console.error('Usage : node scripts/map-png.ts <graine> <largeur> <hauteur> <fichier.png>');
  process.exit(2);
}
const seed = Number(seedArg);
const width = Number(wArg);
const height = Number(hArg);
const world = new World(seed);
const t0 = performance.now();
const stats = generateWorld(world, { width, height });
const ms = performance.now() - t0;
writeFileSync(out, encodePng(worldToRgba(world.grid!), width, height));
console.log(`seed ${seed} ${width}x${height} ${ms.toFixed(0)} ms hash ${hashWorld(world)} -> ${out}`);
console.log(JSON.stringify(stats));
