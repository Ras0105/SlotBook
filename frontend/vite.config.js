import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server runs on 5173, which the backend already allows in CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: ['node_modules', 'dist', 'src/test/integration/**'],
  },
});
