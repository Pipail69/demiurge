// Configuration ESLint « flat » (ESLint 10 + typescript-eslint).
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Fonctions mathématiques dont le résultat n'est PAS garanti au bit près d'un moteur JS à
 * l'autre (la norme ECMAScript laisse leur approximation à l'implémentation). Interdites dans le
 * cœur : décision du propriétaire du 2026-11-11 (docs/decisions.md, T1). Autorisés :
 * + − × ÷, Math.sqrt, Math.SQRT2, Math.fround, Math.imul, floor/ceil/round/trunc/abs/min/max/sign.
 * Liste dupliquée dans tests/forbidden-math.test.ts (test statique indépendant du lint).
 */
const NON_EXACT_MATH = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow', 'cbrt', 'hypot',
];

/** Sources de non-déterminisme ou d'accès à l'hôte, interdites dans le cœur. */
const DETERMINISM_RULES = {
  'no-restricted-properties': [
    'error',
    ...NON_EXACT_MATH.map((property) => ({
      object: 'Math',
      property,
      message: `Math.${property} interdit dans le cœur : résultat non garanti au bit près entre moteurs JS (decisions.md, T1).`,
    })),
    { object: 'Math', property: 'random', message: 'Interdit dans le cœur : utiliser world.rng (règle de déterminisme).' },
    { object: 'Date', property: 'now', message: 'Interdit dans le cœur : le cœur ne lit jamais d\'horloge.' },
    { object: 'performance', property: 'now', message: 'Interdit dans le cœur : le cœur ne lit jamais d\'horloge.' },
  ],
  'no-restricted-globals': [
    'error',
    ...['window', 'document', 'navigator', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'crypto', 'process'].map(
      (name) => ({ name, message: `Global « ${name} » interdit dans le cœur (pur, headless, déterministe).` }),
    ),
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "NewExpression[callee.name='Date']", message: 'new Date interdit dans le cœur : le cœur ne lit jamais d\'horloge.' },
    { selector: "BinaryExpression[operator='**']", message: 'Opérateur ** interdit dans le cœur (non exact entre moteurs) : écrire x*x.' },
    { selector: "AssignmentExpression[operator='**=']", message: 'Opérateur **= interdit dans le cœur (non exact entre moteurs).' },
  ],
};

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts', 'tests/fixtures/**/*.ts'],
    rules: DETERMINISM_RULES,
  },
);
