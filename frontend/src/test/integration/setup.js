import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

window.scrollTo = () => Promise.resolve(); // like modern Chrome, which returns a Promise
afterEach(() => {
  cleanup();
  localStorage.clear();
});
