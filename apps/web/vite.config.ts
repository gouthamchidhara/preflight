import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // dev: API on :3000 (pnpm --filter @umd/api dev); the built app is served by the API itself
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
