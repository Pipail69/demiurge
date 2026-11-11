import { defineConfig } from 'vite';

// Le stub de rendu vit dans src/render/ (index.html + main.ts).
export default defineConfig({
  root: 'src/render',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
