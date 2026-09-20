import { defineConfig } from 'vite';

// Base relativa: el build funciona tanto en la raíz como en subrutas
// (imprescindible para GitHub Pages de proyecto: /cochecitosgame/).
export default defineConfig({
  base: './',
  server: { port: 5173 },
});
