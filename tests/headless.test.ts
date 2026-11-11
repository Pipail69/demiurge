/**
 * Critère d'acceptation T0 (c) : le cœur s'exécute sous Node, sans navigateur.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/core/hash.ts';
import { step } from '../src/core/ecs/world.ts';
import { buildWorkload, DEMO_SEED, DEMO_TICKS } from './fixtures/workload.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'src', 'core');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Spécificateurs de modules d'un source : import/export … from, import(…), require(…), import '…'. */
function moduleSpecifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;
  return [...source.matchAll(re)].map((m) => m[2]!);
}

/** Violations : tout spécificateur non relatif, ou relatif sortant de src/core. */
function importViolations(file: string, source: string): string[] {
  const bad: string[] = [];
  for (const spec of moduleSpecifiers(source)) {
    if (!spec.startsWith('.')) {
      bad.push(`${spec} (module externe)`);
      continue;
    }
    const target = resolve(dirname(file), spec);
    if (target !== CORE && !target.startsWith(CORE + sep)) bad.push(`${spec} (hors de src/core)`);
  }
  return bad;
}

describe('Critère (c) : le cœur tourne sans navigateur', () => {
  it('Vitest tourne en environnement node : pas de window ni de document pendant l\'exécution du cœur', () => {
    const { world } = buildWorkload(DEMO_SEED);
    const observed: string[] = [];
    world.addSystem(() => {
      observed.push(typeof window, typeof document, typeof navigator === 'undefined' ? 'undefined' : 'node-navigator');
    });
    for (let t = 0; t < 10; t++) step(world);
    expect(observed.length).toBe(30);
    for (let k = 0; k < observed.length; k += 3) {
      expect(observed[k]).toBe('undefined'); // window
      expect(observed[k + 1]).toBe('undefined'); // document
    }
  });

  it('analyse statique : aucun fichier de src/core n\'importe hors de src/core', () => {
    const files = listTsFiles(CORE);
    expect(files.length).toBeGreaterThanOrEqual(7);
    const violations: string[] = [];
    let specifiers = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      specifiers += moduleSpecifiers(src).length;
      for (const v of importViolations(f, src)) violations.push(`${relative(ROOT, f)} : ${v}`);
    }
    expect(violations).toEqual([]);
    expect(specifiers).toBeGreaterThan(5); // l'analyse a réellement trouvé des imports
  });

  it('l\'analyse statique détecte bien les imports interdits (contrôle négatif)', () => {
    const fake = join(CORE, 'ecs', 'fake.ts');
    const cases = [
      "import { x } from '../../render/main.ts';",
      "import fs from 'node:fs';",
      "export * from 'vite';",
      "const m = await import('../../../tests/fixtures/workload.ts');",
      "const c = require('crypto');",
      "import './../../render/side-effect.ts';",
    ];
    for (const c of cases) expect(importViolations(fake, c), c).toHaveLength(1);
    expect(importViolations(fake, "import { World } from './world.ts';")).toEqual([]);
    expect(importViolations(fake, "import type { Rng } from '../rng.ts';")).toEqual([]);
  });

  it(`npm run headless (Node pur, hors Vitest) donne le même hash que Vitest (graine ${DEMO_SEED}, ${DEMO_TICKS} ticks)`, () => {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'headless.ts')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    const m = /^FINAL tick (\d+) hash ([0-9a-f]{64})$/m.exec(out);
    expect(m, out).not.toBeNull();
    const { world } = buildWorkload(DEMO_SEED);
    while (world.tick < DEMO_TICKS) step(world);
    expect(Number(m![1])).toBe(DEMO_TICKS);
    expect(m![2]).toBe(hashWorld(world));
  });
});
