/**
 * SHA-256 (FIPS 180-4) en TypeScript pur, synchrone et incrémental.
 *
 * Pourquoi pas node:crypto / crypto.subtle : le cœur doit tourner à l'identique sous
 * Node et dans un Web Worker, de façon synchrone, sans dépendance à l'hôte.
 * Vérifié dans les tests contre node:crypto (oracle autorisé dans tests/ uniquement).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const HEX = '0123456789abcdef';

export class Sha256 {
  private readonly h = new Uint32Array(H0);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLen = 0;
  /** Nombre total d'octets reçus (exact tant que < 2^50 octets). */
  private totalLen = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256 : update après digest');
    let pos = 0;
    const len = data.length;
    this.totalLen += len;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, len);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      pos = take;
      if (this.blockLen === 64) {
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
    }
    while (len - pos >= 64) {
      this.compress(data, pos);
      pos += 64;
    }
    if (pos < len) {
      this.block.set(data.subarray(pos), 0);
      this.blockLen = len - pos;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256 : digest appelé deux fois');
    const bitLenHi = Math.floor(this.totalLen / 0x20000000); // (len * 8) / 2^32
    const bitLenLo = (this.totalLen * 8) % 4294967296;
    // Bourrage : 0x80, zéros, puis longueur en bits sur 64 bits gros-boutiste.
    const padLen = this.blockLen < 56 ? 56 - this.blockLen : 120 - this.blockLen;
    const pad = new Uint8Array(padLen + 8);
    pad[0] = 0x80;
    pad[padLen] = bitLenHi >>> 24;
    pad[padLen + 1] = (bitLenHi >>> 16) & 0xff;
    pad[padLen + 2] = (bitLenHi >>> 8) & 0xff;
    pad[padLen + 3] = bitLenHi & 0xff;
    pad[padLen + 4] = bitLenLo >>> 24;
    pad[padLen + 5] = (bitLenLo >>> 16) & 0xff;
    pad[padLen + 6] = (bitLenLo >>> 8) & 0xff;
    pad[padLen + 7] = bitLenLo & 0xff;
    const savedTotal = this.totalLen;
    this.update(pad);
    this.totalLen = savedTotal;
    this.finished = true;
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const v = this.h[i]!;
      out[i * 4] = v >>> 24;
      out[i * 4 + 1] = (v >>> 16) & 0xff;
      out[i * 4 + 2] = (v >>> 8) & 0xff;
      out[i * 4 + 3] = v & 0xff;
    }
    return out;
  }

  digestHex(): string {
    return toHex(this.digest());
  }

  private compress(data: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (data[j]! << 24) | (data[j + 1]! << 16) | (data[j + 2]! << 8) | data[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    const h = this.h;
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    s += HEX[b >>> 4]! + HEX[b & 0xf]!;
  }
  return s;
}

export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).digestHex();
}
