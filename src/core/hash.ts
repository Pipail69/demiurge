/**
 * Hash SHA-256 de l'état logique complet du monde (format exact : docs/models.md § Hash).
 *
 * Chaque section = étiquette ASCII préfixée par sa longueur (u32 LE), longueur de la charge
 * utile en octets (u64 LE), puis la charge utile. Les entiers d'en-tête sont écrits en
 * petit-boutiste explicite ; les tableaux typés sont lus via une vue Uint8Array, donc dans
 * le boutisme de la plateforme → petit-boutisme EXIGÉ (vérifié à l'exécution).
 *
 * Ne sont PAS hachés (pas d'état logique) : la capacité allouée, le contenu des tableaux
 * au-delà de highWater, la liste libre au-delà de freeCount, aliveCount (dérivable),
 * la liste des systèmes (c'est du code), l'accumulateur de la boucle (temps réel).
 */

import { Sha256 } from './sha256.ts';
import type { World } from './ecs/world.ts';

export const HASH_FORMAT_VERSION = 1;

export function detectLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

/** Lève une erreur explicite si la plateforme n'est pas petit-boutiste. */
export function assertLittleEndian(isLittleEndian: boolean = detectLittleEndian()): void {
  if (!isLittleEndian) {
    throw new Error(
      'hashWorld : plateforme gros-boutiste non prise en charge (le format de hash exige le petit-boutisme ; voir docs/decisions.md)',
    );
  }
}

type Typed = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

class CanonicalWriter {
  private readonly sha = new Sha256();
  private readonly scratch = new Uint8Array(8);
  private readonly view = new DataView(this.scratch.buffer);
  private expected = 0;
  private written = 0;

  section(label: string, payloadLength: number): void {
    this.endSection();
    this.rawU32(label.length);
    this.rawAscii(label);
    this.rawU64(payloadLength);
    this.expected = payloadLength;
    this.written = 0;
  }

  u32(v: number): void {
    this.rawU32(v);
    this.written += 4;
  }

  u64(v: number): void {
    this.rawU64(v);
    this.written += 8;
  }

  ascii(s: string): void {
    this.rawAscii(s);
    this.written += s.length;
  }

  /** Octets des `count` premiers éléments du tableau (boutisme de la plateforme). */
  elements(arr: Typed, count: number): void {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, count * arr.BYTES_PER_ELEMENT);
    this.sha.update(bytes);
    this.written += bytes.length;
  }

  finish(): string {
    this.endSection();
    return this.sha.digestHex();
  }

  private endSection(): void {
    if (this.written !== this.expected) {
      throw new Error(`hashWorld : section mal formée (${this.written} octets écrits, ${this.expected} annoncés)`);
    }
  }

  private rawU32(v: number): void {
    this.view.setUint32(0, v, true);
    this.sha.update(this.scratch.subarray(0, 4));
  }

  private rawU64(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`hashWorld : u64 invalide ${v}`);
    this.view.setUint32(0, v % 4294967296, true);
    this.view.setUint32(4, Math.floor(v / 4294967296), true);
    this.sha.update(this.scratch);
  }

  private rawAscii(s: string): void {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0x7f) throw new Error(`hashWorld : caractère non ASCII dans « ${s} »`);
      b[i] = c;
    }
    this.sha.update(b);
  }
}

/** Hash hexadécimal (64 caractères) de l'état logique complet du monde. */
export function hashWorld(world: World): string {
  assertLittleEndian();
  const w = new CanonicalWriter();
  const a = world.entities;
  const hw = a.highWater;

  w.section('format', 4);
  w.u32(HASH_FORMAT_VERSION);
  w.section('seed', 4);
  w.u32(world.seed);
  w.section('tick', 8);
  w.u64(world.tick);
  w.section('rng', 16);
  w.elements(world.rng.state, 4);

  w.section('entities.highWater', 4);
  w.u32(hw);
  w.section('entities.alive', hw);
  w.elements(a.alive, hw);
  w.section('entities.generation', hw * 4);
  w.elements(a.generation, hw);
  w.section('entities.freeList', a.freeCount * 4);
  w.elements(a.freeList, a.freeCount);

  w.section('components.count', 4);
  w.u32(world.components.length);
  for (const c of world.components) {
    w.section('component.name', c.name.length);
    w.ascii(c.name);
    const schema = c.fieldNames.map((f, i) => `${f}:${c.fieldTypes[i]!}`).join(';');
    w.section('component.schema', schema.length);
    w.ascii(schema);
    w.section('component.present', hw);
    w.elements(c.present, hw);
    for (let i = 0; i < c.fieldNames.length; i++) {
      const arr = c.fieldArrays[i]!;
      w.section(`field:${c.fieldNames[i]!}`, hw * arr.BYTES_PER_ELEMENT);
      w.elements(arr, hw);
    }
  }
  return w.finish();
}
