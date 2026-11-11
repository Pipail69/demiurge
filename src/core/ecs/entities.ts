/**
 * Allocateur d'entités : index uint32 + génération.
 *
 * - alive[i] ∈ {0,1}, generation[i] (uint32, incrémentée à chaque destruction).
 * - Liste libre en PILE LIFO (Uint32Array) : l'index libéré en dernier est réutilisé
 *   en premier. Recyclage entièrement déterministe.
 * - highWater = nombre d'emplacements jamais alloués ; seul [0, highWater) est un état
 *   logique. La capacité allouée (≥ highWater) n'en fait pas partie.
 *
 * Poignée (Entity) : un nombre = (génération mod 2^21) × 2^32 + index, toujours < 2^53.
 */

/** Poignée d'entité opaque (entier exact < 2^53). */
export type Entity = number;

export const GENERATION_BITS = 21;
export const GENERATION_MASK = (1 << GENERATION_BITS) - 1; // 0x1FFFFF
const TWO_POW_32 = 4294967296;

export function makeEntity(index: number, generation: number): Entity {
  return (generation & GENERATION_MASK) * TWO_POW_32 + index;
}

export function entityIndex(e: Entity): number {
  return e >>> 0; // ToUint32 = e mod 2^32
}

export function entityGeneration(e: Entity): number {
  return Math.floor(e / TWO_POW_32);
}

export class EntityAllocator {
  capacity: number;
  highWater = 0;
  aliveCount = 0;
  freeCount = 0;
  alive: Uint8Array;
  generation: Uint32Array;
  freeList: Uint32Array;

  constructor(initialCapacity: number) {
    if (!Number.isInteger(initialCapacity) || initialCapacity < 1) {
      throw new RangeError(`Capacité initiale invalide : ${String(initialCapacity)}`);
    }
    this.capacity = initialCapacity;
    this.alive = new Uint8Array(initialCapacity);
    this.generation = new Uint32Array(initialCapacity);
    this.freeList = new Uint32Array(initialCapacity);
  }

  /** Vrai si la prochaine allocation exige d'agrandir les tableaux. */
  needsGrowth(): boolean {
    return this.freeCount === 0 && this.highWater === this.capacity;
  }

  /** Agrandit les tableaux (copie de l'existant, le reste à zéro). */
  grow(newCapacity: number): void {
    if (newCapacity <= this.capacity) return;
    if (newCapacity > TWO_POW_32) throw new RangeError('Capacité maximale d\'entités (2^32) dépassée');
    const alive = new Uint8Array(newCapacity);
    alive.set(this.alive);
    const generation = new Uint32Array(newCapacity);
    generation.set(this.generation);
    const freeList = new Uint32Array(newCapacity);
    freeList.set(this.freeList);
    this.alive = alive;
    this.generation = generation;
    this.freeList = freeList;
    this.capacity = newCapacity;
  }

  /** Alloue un index (l'appelant garantit la capacité). */
  allocate(): Entity {
    let index: number;
    if (this.freeCount > 0) {
      this.freeCount--;
      index = this.freeList[this.freeCount]!;
      this.freeList[this.freeCount] = 0; // forme canonique : pas de résidu au-delà de freeCount
    } else {
      if (this.highWater >= this.capacity) throw new Error('EntityAllocator : capacité épuisée (appeler grow)');
      index = this.highWater++;
    }
    this.alive[index] = 1;
    this.aliveCount++;
    return makeEntity(index, this.generation[index]!);
  }

  /** Libère un index vivant : alive=0, génération+1, empilé sur la liste libre. */
  release(index: number): void {
    this.alive[index] = 0;
    this.generation[index] = (this.generation[index]! + 1) >>> 0;
    this.freeList[this.freeCount++] = index;
    this.aliveCount--;
  }

  isAlive(e: Entity): boolean {
    const index = entityIndex(e);
    return (
      index < this.highWater &&
      this.alive[index] === 1 &&
      (this.generation[index]! & GENERATION_MASK) === entityGeneration(e)
    );
  }

  /** Poignée courante de l'entité vivante à cet index. */
  handleOf(index: number): Entity {
    return makeEntity(index, this.generation[index]!);
  }
}
