/**
 * Mesure de la génération (critère T1 d) : N exécutions (défaut 5), min / médiane / max, et
 * détail par étape mesuré DEPUIS L'EXTÉRIEUR via le crochet onStage (le cœur ne lit aucune
 * horloge). Usage : npm run bench:worldgen -- [graine] [largeur] [hauteur] [exécutions]
 */
import { generateWorld, World, WORLDGEN_STAGES } from '../src/core/index.ts';

const n = (i: number, d: number): number => (process.argv[i] === undefined ? d : Number(process.argv[i]));
const seed = n(2, 20261111);
const width = n(3, 512);
const height = n(4, 512);
const runs = n(5, 5);

const totals: number[] = [];
const perStage: number[][] = WORLDGEN_STAGES.map(() => []);
for (let r = 0; r < runs; r++) {
  const marks: { stage: string; t: number }[] = [];
  const world = new World(seed);
  const t0 = performance.now();
  generateWorld(world, { width, height }, { onStage: (stage) => marks.push({ stage, t: performance.now() }) });
  totals.push(performance.now() - t0);
  for (let i = 0; i < marks.length - 1; i++) {
    const k = WORLDGEN_STAGES.indexOf(marks[i]!.stage);
    perStage[k]!.push(marks[i + 1]!.t - marks[i]!.t);
  }
}
const sorted = (a: number[]): number[] => [...a].sort((x, y) => x - y);
const median = (a: number[]): number => sorted(a)[Math.floor(a.length / 2)]!;
const s = sorted(totals);
console.log(`seed ${seed} ${width}x${height}, ${runs} exécutions (Node ${process.version})`);
console.log(`total ms : min ${s[0]!.toFixed(1)} ; médiane ${median(totals).toFixed(1)} ; max ${s.at(-1)!.toFixed(1)} ; toutes ${totals.map((t) => t.toFixed(0)).join(', ')}`);
WORLDGEN_STAGES.forEach((name, k) => {
  const a = perStage[k]!;
  console.log(`  ${name.padEnd(12)} médiane ${median(a).toFixed(1)} ms (min ${sorted(a)[0]!.toFixed(1)}, max ${sorted(a).at(-1)!.toFixed(1)})`);
});
