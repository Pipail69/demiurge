/**
 * File de priorité minimale (tas binaire) de cellules sur tableaux typés.
 *
 * Ordre TOTAL et déterministe : clé = (niveau, index de cellule), comparaison
 * lexicographique. Deux entrées ne sont jamais « égales » tant qu'une cellule n'est poussée
 * qu'une fois : l'ordre de sortie ne dépend donc pas de la structure interne du tas.
 */
export class CellHeap {
  private readonly levels: Int32Array;
  private readonly cells: Int32Array;
  size = 0;
  /** Niveau de la dernière cellule sortie par pop(). */
  lastLevel = 0;

  constructor(capacity: number) {
    this.levels = new Int32Array(capacity);
    this.cells = new Int32Array(capacity);
  }

  private less(a: number, b: number): boolean {
    const la = this.levels[a]!;
    const lb = this.levels[b]!;
    return la < lb || (la === lb && this.cells[a]! < this.cells[b]!);
  }

  private swap(a: number, b: number): void {
    const l = this.levels[a]!;
    this.levels[a] = this.levels[b]!;
    this.levels[b] = l;
    const c = this.cells[a]!;
    this.cells[a] = this.cells[b]!;
    this.cells[b] = c;
  }

  push(level: number, cell: number): void {
    if (this.size >= this.cells.length) throw new Error('CellHeap : capacité dépassée');
    let i = this.size++;
    this.levels[i] = level;
    this.cells[i] = cell;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Retire et renvoie la cellule de plus petite clé (niveau, index) ; son niveau → lastLevel. */
  pop(): number {
    if (this.size === 0) throw new Error('CellHeap : file vide');
    const top = this.cells[0]!;
    this.lastLevel = this.levels[0]!;
    this.size--;
    if (this.size > 0) {
      this.levels[0] = this.levels[this.size]!;
      this.cells[0] = this.cells[this.size]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}
