/**
 * Test statique (indépendant d'ESLint) : aucune fonction mathématique non exacte entre moteurs
 * JS dans src/core (décision du propriétaire, 2026-11-11 ; docs/decisions.md, T1).
 * Les commentaires et le contenu des chaînes sont retirés avant la recherche (« xoshiro128** »
 * dans un commentaire n'est pas l'opérateur **). Limites (voir STATE.md, décision ouverte c) :
 * alias (`const M = Math`), accès calculé (`Math['sin']`), `globalThis.Math`… ne sont pas vus.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'src', 'core');

/** Liste dupliquée volontairement depuis eslint.config.js (deux garde-fous indépendants). */
const FORBIDDEN = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow', 'cbrt', 'hypot',
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Retire commentaires et contenu des littéraux de chaîne ; garde le code des expressions
 * `${…}` des gabarits (pile d'imbrication). Les expressions régulières littérales ne sont pas
 * reconnues (traitées comme du code).
 */
export function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const stack: number[] = []; // profondeur d'accolades à laquelle reprendre un gabarit
  let depth = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === '\'' || ch === '"') {
      i++;
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += '""';
      continue;
    }
    if (ch === '`' || (ch === '}' && stack.length > 0 && stack[stack.length - 1] === depth)) {
      if (ch === '}') stack.pop();
      i++;
      // Contenu du gabarit jusqu'au ` fermant ou à ${.
      while (i < src.length && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) i += src[i] === '\\' ? 2 : 1;
      if (src[i] === '$') {
        stack.push(depth);
        i += 2;
        out += '`${';
      } else {
        i++;
        out += '``';
      }
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}

export function violations(src: string): string[] {
  const code = stripCommentsAndStrings(src);
  const bad: string[] = [];
  const re = new RegExp(`\\bMath\\s*\\.\\s*(${FORBIDDEN.join('|')})\\b`, 'g');
  for (const m of code.matchAll(re)) bad.push(`Math.${m[1]!}`);
  if (/\*\*/.test(code)) bad.push('opérateur **');
  return bad;
}

describe('Fonctions mathématiques non exactes interdites dans src/core', () => {
  it('aucune occurrence dans src/core/**', () => {
    const files = listTsFiles(CORE);
    expect(files.length).toBeGreaterThanOrEqual(15);
    const found: string[] = [];
    let mathCalls = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      mathCalls += (stripCommentsAndStrings(src).match(/\bMath\s*\./g) ?? []).length;
      for (const v of violations(src)) found.push(`${relative(ROOT, f)} : ${v}`);
    }
    expect(found).toEqual([]);
    expect(mathCalls).toBeGreaterThan(20); // l'analyse voit réellement le code (Math.floor, Math.sqrt…)
  });

  it('contrôle négatif : chaque fonction interdite et ** sont détectés, y compris dans ${…}', () => {
    for (const f of FORBIDDEN) expect(violations(`const v = Math.${f}(x);`), f).toEqual([`Math.${f}`]);
    expect(violations('const v = Math . pow (2, 3);')).toEqual(['Math.pow']);
    expect(violations('let a = 2 ** 3;')).toEqual(['opérateur **']);
    expect(violations('a **= 2;')).toEqual(['opérateur **']);
    expect(violations('const s = `t=${Math.exp(1)}`;')).toEqual(['Math.exp']);
    expect(violations('const s = `a${`b${Math.log(2)}`}c`;')).toEqual(['Math.log']);
  });

  it('pas de faux positif : commentaires, chaînes, fonctions autorisées', () => {
    expect(violations('// Math.sin(x) et 2 ** 3 en commentaire\n/* Math.pow ** */ const a = 1;')).toEqual([]);
    expect(violations('const s = "Math.sin ** \\" Math.cos"; const t = \'Math.exp\';')).toEqual([]);
    expect(violations('const s = `Math.sin ${1 + 2} **`;')).toEqual([]);
    expect(violations('Math.sqrt(2) * Math.SQRT2 + Math.fround(1) + Math.imul(2, 3) + Math.floor(x) + Math.sign(y);')).toEqual([]);
    expect(violations('const sinh = mySin(x); obj.Math_sin(1); Math.sinusoid;')).toEqual([]);
  });
});
