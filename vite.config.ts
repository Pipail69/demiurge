import { defineConfig } from 'vite';

// Le stub de rendu vit dans src/render/ (index.html + main.ts).
export default defineConfig({
  // Chemins relatifs : la page est servie sous /demiurge/ (GitHub Pages) ; ils fonctionnent aussi
  // à la racine d'un autre hébergeur. Vérifié par `npm run check:dist`.
  base: './',
  root: 'src/render',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
