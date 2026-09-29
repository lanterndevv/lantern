import { defineConfig } from 'vite';

const API = process.env.LANTERN_API ?? 'http://localhost:8787'; // tools/e2e lo cambia

export default defineConfig({
  server: { proxy: { '/api': API, '/assets': API, '/ws': { target: API.replace(/^http/, 'ws'), ws: true } } },
  // Build en /static/: /assets/ es de los archivos que suben los DM (servidor).
  build: { assetsDir: 'static', rollupOptions: { input: ['index.html', 'render-demo.html', 'dice-demo.html'] } },
});
