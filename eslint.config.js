// Configuration ESLint « flat » (ESLint 10 + typescript-eslint).
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Sources de non-déterminisme ou d'accès à l'hôte, interdites dans le cœur. */
const DETERMINISM_RULES = {
  'no-restricted-properties': [
    'error',
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
