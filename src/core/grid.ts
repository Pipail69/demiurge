/**
 * Grille dense W×H de cellules : ressource du monde (motif « ressource » d'un ECS).
 *
 * Le terrain n'est pas fait d'entités : chaque cellule existe toujours, n'a pas d'identité
 * propre et se repère par son index `y·W + x`. Les données sont des COUCHES : un tableau typé
 * ENTIER par grandeur (élévation, eau, biome…), de longueur W·H. Les couches sont rangées dans
 * un TABLEAU ordonné (ordre d'enregistrement = ordre de hachage), jamais dans une Map ni un
 * objet itéré. Voir docs/models.md § Grille.
 */

import { allocateField, assertValidName, type FieldArrayMap } from './ecs/component.ts';

/** Types de couches autorisés : entiers uniquement (comparaisons exactes, conservation exacte). */
export type LayerType = 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32';

export const LAYER_TYPES: readonly LayerType[] = ['i8', 'i16', 'i32', 'u8', 'u16', 'u32'];

export type LayerArray = FieldArrayMap[LayerType];

export interface GridLayer {
  readonly name: string;
  readonly type: LayerType;
  readonly data: LayerArray;
}

/** Dimension maximale d'un côté (borne de sûreté : W·H < 2^24, débits u32 sans dépassement). */
export const GRID_MAX_SIDE = 4096;

export class Grid {
  readonly width: number;
  readonly height: number;
  /** Nombre de cellules W·H. */
  readonly size: number;
  /** Couches dans l'ordre d'enregistrement. */
  readonly layers: GridLayer[] = [];

  constructor(width: number, height: number) {
    for (const [v, what] of [[width, 'largeur'], [height, 'hauteur']] as const) {
      if (!Number.isInteger(v) || v < 1 || v > GRID_MAX_SIDE) {
        throw new RangeError(`Grille : ${what} invalide ${String(v)} (entier dans [1, ${GRID_MAX_SIDE}])`);
      }
    }
    this.width = width;
    this.height = height;
    this.size = width * height;
  }

  /** Enregistre une couche (remplie de zéros) et renvoie son tableau. Nom unique, ASCII. */
  addLayer<T extends LayerType>(name: string, type: T): FieldArrayMap[T] {
    assertValidName(name, 'Nom de couche');
    if (!LAYER_TYPES.includes(type)) throw new Error(`Couche « ${name} » : type non entier ou inconnu ${String(type)}`);
    if (this.findLayer(name) !== undefined) throw new Error(`Couche « ${name} » déjà enregistrée`);
    const data = allocateField(type, this.size) as FieldArrayMap[T];
    this.layers.push({ name, type, data });
    return data;
  }

  /** Couche par nom (recherche linéaire dans le tableau ordonné), ou undefined. */
  findLayer(name: string): GridLayer | undefined {
    for (const l of this.layers) if (l.name === name) return l;
    return undefined;
  }

  /** Tableau de la couche nommée ; erreur si absente. */
  layer(name: string): LayerArray {
    const l = this.findLayer(name);
    if (l === undefined) throw new Error(`Couche « ${name} » absente`);
    return l.data;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }
}
