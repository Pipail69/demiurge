/**
 * Composants en structure de tableaux typés (SoA).
 *
 * Un composant est défini par un schéma { champ: type }. L'ordre des champs est FIGÉ
 * à l'enregistrement : noms triés par ordre des unités de code UTF-16 (ordre lexicographique
 * de String.prototype.sort sans comparateur). Aucune logique ne dépend ensuite de l'ordre
 * d'itération de l'objet schéma.
 */

export type FieldType = 'f32' | 'f64' | 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32';

export interface FieldArrayMap {
  f32: Float32Array;
  f64: Float64Array;
  i8: Int8Array;
  i16: Int16Array;
  i32: Int32Array;
  u8: Uint8Array;
  u16: Uint16Array;
  u32: Uint32Array;
}

export type FieldArray = FieldArrayMap[FieldType];

export type Schema = Readonly<Record<string, FieldType>>;

export type Fields<S extends Schema> = { readonly [K in keyof S]: FieldArrayMap[S[K]] };

/** Types valides, dans un tableau (pas d'itération d'objet). */
export const FIELD_TYPES: readonly FieldType[] = ['f32', 'f64', 'i8', 'i16', 'i32', 'u8', 'u16', 'u32'];

/** Identifiants ASCII uniquement (pas de clé « entière », hachage ASCII trivial). */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertValidName(name: string, what: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`${what} invalide « ${name} » : attendu /^[A-Za-z_][A-Za-z0-9_]*$/`);
  }
}

export function allocateField(type: FieldType, length: number): FieldArray {
  switch (type) {
    case 'f32': return new Float32Array(length);
    case 'f64': return new Float64Array(length);
    case 'i8': return new Int8Array(length);
    case 'i16': return new Int16Array(length);
    case 'i32': return new Int32Array(length);
    case 'u8': return new Uint8Array(length);
    case 'u16': return new Uint16Array(length);
    case 'u32': return new Uint32Array(length);
  }
}

export class ComponentStore<S extends Schema = Schema> {
  readonly id: number;
  readonly name: string;
  /** Noms des champs dans l'ordre figé (trié). */
  readonly fieldNames: readonly string[];
  /** Types des champs, alignés sur fieldNames. */
  readonly fieldTypes: readonly FieldType[];
  /** Présence par entité (0/1). Remplacé à chaque croissance de capacité. */
  present: Uint8Array;
  /** Tableaux de champs alignés sur fieldNames. Remplacés à chaque croissance. */
  fieldArrays: FieldArray[];
  /** Accès par nom : store.fields.x[index]. Remplacé à chaque croissance. */
  fields: Fields<S>;

  constructor(id: number, name: string, schema: S, capacity: number) {
    assertValidName(name, 'Nom de composant');
    this.id = id;
    this.name = name;
    const names = Object.keys(schema).sort();
    if (names.length === 0) throw new Error(`Composant « ${name} » : schéma vide`);
    const types: FieldType[] = [];
    for (const f of names) {
      assertValidName(f, `Champ de « ${name} »`);
      const t = schema[f];
      if (t === undefined || !FIELD_TYPES.includes(t)) {
        throw new Error(`Composant « ${name} », champ « ${f} » : type inconnu ${String(t)}`);
      }
      types.push(t);
    }
    this.fieldNames = Object.freeze(names);
    this.fieldTypes = Object.freeze(types);
    this.present = new Uint8Array(capacity);
    this.fieldArrays = types.map((t) => allocateField(t, capacity));
    this.fields = this.buildFieldsObject();
  }

  /** Agrandit tous les tableaux à newCapacity (copie, reste à zéro). */
  grow(newCapacity: number): void {
    const present = new Uint8Array(newCapacity);
    present.set(this.present);
    this.present = present;
    this.fieldArrays = this.fieldArrays.map((old, i) => {
      const arr = allocateField(this.fieldTypes[i]!, newCapacity);
      // Même type par construction.
      (arr as Float64Array).set(old as Float64Array);
      return arr;
    });
    this.fields = this.buildFieldsObject();
  }

  /** Remet à zéro tous les champs et la présence à l'index (forme canonique). */
  clear(index: number): void {
    this.present[index] = 0;
    for (const arr of this.fieldArrays) arr[index] = 0;
  }

  private buildFieldsObject(): Fields<S> {
    // Prototype nul : un champ nommé « __proto__ » reste une propriété ordinaire.
    const obj = Object.create(null) as Record<string, FieldArray>;
    for (let i = 0; i < this.fieldNames.length; i++) obj[this.fieldNames[i]!] = this.fieldArrays[i]!;
    return Object.freeze(obj) as unknown as Fields<S>;
  }
}
