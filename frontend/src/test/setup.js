import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

// Pages are lazy-loaded (code splitting); the first import of a page in a test file is compiled
// on demand, which can take longer than Testing Library's default 1 s wait.
configure({ asyncUtilTimeout: 5000 });
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Remembered choices (e.g. the selected class) must not leak between tests.
  window.localStorage.clear();
});
