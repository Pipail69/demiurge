/**
 * Vérifie que le build (dist/) n'utilise que des chemins relatifs : la page est servie sous
 * un sous-chemin (/demiurge/ sur GitHub Pages), une URL d'asset commençant par « / » ou par
 * « http(s):// » local casserait le chargement.
 * Lancement : `npm run check:dist` (après `npm run build`). Code de sortie 1 si un chemin
 * absolu est trouvé ou si dist/index.html est absent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html absent : lancer `npm run build` d\'abord.');
  process.exit(1);
}

const problems: string[] = [];
let checked = 0;
for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.html')) {
    checked++;
    // Attributs src/href/srcset/poster/data valant « /… » (mais pas « // » ni « # »).
    for (const m of text.matchAll(/\b(?:src|href|poster|data|srcset)\s*=\s*["']\s*(\/[^"']*)["']/gi)) {
      problems.push(`${file} : attribut vers un chemin absolu « ${m[1]} »`);
    }
  } else if (file.endsWith('.css')) {
    checked++;
    for (const m of text.matchAll(/url\(\s*["']?(\/[^)"']*)/gi)) {
      problems.push(`${file} : url() vers un chemin absolu « ${m[1]} »`);
    }
  } else if (file.endsWith('.js')) {
    checked++;
    // Filet de sécurité : littéral de chaîne « /assets/… » dans le bundle.
    for (const m of text.matchAll(/["'`](\/assets\/[^"'`]*)["'`]/g)) {
      problems.push(`${file} : littéral « ${m[1]} » dans le JS`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`ÉCHEC : ${problems.length} chemin(s) absolu(s).`);
  process.exit(1);
}
console.log(`OK : ${checked} fichier(s) html/css/js de ${DIST}/ sans chemin absolu.`);
