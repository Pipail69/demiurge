import { createHash } from 'node:crypto'; // oracle autorisé dans tests/ uniquement
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import { Sha256, sha256Hex } from '../src/core/sha256.ts';

const oracle = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

function randomBytes(rng: Rng, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = rng.nextInt(256);
  return b;
}

describe('SHA-256 pur TypeScript', () => {
  it('vecteurs FIPS 180-4 : chaîne vide et "abc"', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('identique à node:crypto pour toutes les longueurs 0..300 (frontières de bourrage incluses)', () => {
    const rng = new Rng(1);
    let checked = 0;
    for (let len = 0; len <= 300; len++) {
      for (let rep = 0; rep < 3; rep++) {
        const data = randomBytes(rng, len);
        expect(sha256Hex(data), `longueur ${len}`).toBe(oracle(data));
        checked++;
      }
    }
    expect(checked).toBe(903);
    // Frontières explicitement listées dans la consigne.
    for (const len of [55, 56, 63, 64, 65, 119, 120]) {
      const data = randomBytes(rng, len);
      expect(sha256Hex(data)).toBe(oracle(data));
    }
  });

  it('API incrémentale : découpage arbitraire = hash d\'un bloc', () => {
    const rng = new Rng(2);
    for (let t = 0; t < 50; t++) {
      const data = randomBytes(rng, rng.nextInt(400));
      const h = new Sha256();
      let pos = 0;
      while (pos < data.length) {
        const n = Math.min(data.length - pos, rng.nextInt(80));
        h.update(data.subarray(pos, pos + n));
        pos += n;
      }
      expect(h.digestHex()).toBe(oracle(data));
    }
  });

  it('tampon de 5 Mo alimenté en morceaux irréguliers', () => {
    const rng = new Rng(3);
    const size = 5 * 1024 * 1024 + 13;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 4) {
      const v = rng.nextU32();
      data[i] = v & 0xff;
      if (i + 1 < size) data[i + 1] = (v >>> 8) & 0xff;
      if (i + 2 < size) data[i + 2] = (v >>> 16) & 0xff;
      if (i + 3 < size) data[i + 3] = v >>> 24;
    }
    const h = new Sha256();
    let pos = 0;
    let chunks = 0;
    while (pos < size) {
      const n = Math.min(size - pos, 1 + rng.nextInt(70000));
      h.update(data.subarray(pos, pos + n));
      pos += n;
      chunks++;
    }
    expect(chunks).toBeGreaterThan(100);
    expect(h.digestHex()).toBe(oracle(data));
  });

  it('refuse update/digest après digest', () => {
    const h = new Sha256();
    h.digest();
    expect(() => h.update(new Uint8Array(1))).toThrow();
    expect(() => h.digest()).toThrow();
  });
});
