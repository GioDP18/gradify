import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/setup/globalSetup.js'],
    hookTimeout: 120000, // first run downloads the MongoDB test binary
    // Many parallel workers (each loading native bcrypt + a DB client) crashed on Windows
    // with 0xC0000409; two workers are stable and still fast.
    maxWorkers: 2,
    testTimeout: 20000,
    // Tests never read backend/.env; they get a safe, isolated configuration.
    env: {
      NODE_ENV: 'test',
      // One trusted proxy, so tests can act as distinct client IPs with X-Forwarded-For.
      TRUST_PROXY: '1',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/',
      MONGODB_DB_NAME: 'evsu_grading_system_test',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-characters',
      CLIENT_URL: 'http://localhost:5173',
      BCRYPT_ROUNDS: '10',
      CRON_SECRET: 'test-cron-secret-that-is-at-least-32-characters',
    },
  },
});
