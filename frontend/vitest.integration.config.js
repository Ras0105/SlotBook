import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// End-to-end tests: the real React app talking to the REAL backend (no mocks).
// Start the backend first (see README), then run:  npm run test:integration
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/integration/setup.js',
    include: ['src/test/integration/**/*.test.jsx'],
    testTimeout: 30_000,
  },
});
