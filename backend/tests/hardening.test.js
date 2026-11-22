/**
 * L-3 (no development defaults on a hosted deployment) and I-1 (bcrypt's 72-byte limit).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createErrorHandler } from '../src/middleware/errorHandler.js';
import { checkPasswordStrength, passwordFitsBcrypt, MAX_PASSWORD_BYTES } from '../src/utils/password.js';
import { logger } from '../src/config/logger.js';
import { useTestDatabase } from './helpers/db.js';
import { adminSession, createUser, loginAs, DEFAULT_PASSWORD } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

const base = {
  MONGODB_URI: 'mongodb+srv://u:p@cluster.example.net/',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  CLIENT_URL: 'https://grades.example.edu',
};

describe('L-3: NODE_ENV on Vercel', () => {
  it('refuses to start on Vercel when NODE_ENV is missing', () => {
    expect(() => loadConfig({ ...base, VERCEL: '1', TRUST_PROXY: '1' })).toThrowError(/NODE_ENV must be set on Vercel/);
    expect(() => loadConfig({ ...base, VERCEL: '1', TRUST_PROXY: '1', NODE_ENV: '' })).toThrowError(/NODE_ENV must be set on Vercel/);
  });

  it('starts on Vercel with NODE_ENV=production, and locally without NODE_ENV', () => {
    expect(loadConfig({ ...base, VERCEL: '1', TRUST_PROXY: '1', NODE_ENV: 'production' }).isProduction).toBe(true);
    expect(loadConfig(base).isDevelopment).toBe(true); // local development default is unchanged
  });

  it('exposes stack traces only in local development, never on Vercel', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).exposeErrorStacks).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development', VERCEL: '1' }).exposeErrorStacks).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'production', TRUST_PROXY: '1' }).exposeErrorStacks).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).exposeErrorStacks).toBe(false);
  });
});

describe('L-3: error responses', () => {
  const crashApp = (exposeStacks) => {
    const tiny = express();
    tiny.get('/boom', () => { throw new Error('secret internal detail'); });
    tiny.use(createErrorHandler({ exposeStacks }));
    return tiny;
  };

  it('includes a stack trace only when told to', async () => {
    const quiet = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const hidden = await request(crashApp(false)).get('/boom');
    expect(hidden.status).toBe(500);
    expect(hidden.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(hidden.body)).not.toMatch(/stack|secret internal detail/);

    const shown = await request(crashApp(true)).get('/boom');
    expect(shown.body.error.stack).toMatch(/secret internal detail/);
    quiet.mockRestore();
  });
});

describe('I-1: passwords are capped at 72 bytes', () => {
  const strong72 = `Aa1!${'x'.repeat(68)}`; // exactly 72 bytes
  const strong73 = `${strong72}y`;
  // 40 characters but 76 bytes: "é" is two bytes in UTF-8.
  const accented = `Aa1!${'é'.repeat(36)}`;

  it('measures bytes, not characters', () => {
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordFitsBcrypt(strong72)).toBe(true);
    expect(passwordFitsBcrypt(strong73)).toBe(false);
    expect(accented).toHaveLength(40);
    expect(passwordFitsBcrypt(accented)).toBe(false);
    expect(checkPasswordStrength(strong72)).toEqual([]);
    expect(checkPasswordStrength(strong73)).toEqual(['at most 72 bytes (72 plain letters; fewer with accents or emoji)']);
    expect(checkPasswordStrength(accented)).toEqual(['at most 72 bytes (72 plain letters; fewer with accents or emoji)']);
  });

  it('login refuses an over-long password with a clear message, before checking it', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login').send({ identifier: user.email, password: strong73 });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ field: 'password', message: 'Password is too long: at most 72 bytes (72 plain letters; fewer with accents or emoji)' }]);
    // A 72-byte password is still checked normally.
    expect((await request(app).post('/api/auth/login').send({ identifier: user.email, password: strong72 })).status).toBe(401);
  });

  it('changing a password accepts 72 bytes and refuses 73 (or fewer characters with accents)', async () => {
    const user = await createUser();
    const { accessToken, cookie } = await loginAs(app, user);
    const change = (token, body) => request(app).put('/api/auth/me/password').set('Authorization', `Bearer ${token}`).set('Cookie', cookie).send(body);

    for (const tooLong of [strong73, accented]) {
      const res = await change(accessToken, { currentPassword: DEFAULT_PASSWORD, newPassword: tooLong });
      expect(res.status).toBe(422);
      expect(res.body.error.details[0]).toMatchObject({ field: 'newPassword', message: expect.stringMatching(/at most 72 bytes/) });
    }
    const tooLongCurrent = await change(accessToken, { currentPassword: strong73, newPassword: 'Another-Passw0rd!' });
    expect(tooLongCurrent.body.error.details[0]).toMatchObject({ field: 'currentPassword', message: expect.stringMatching(/at most 72 bytes/) });

    const ok = await change(accessToken, { currentPassword: DEFAULT_PASSWORD, newPassword: strong72 });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ identifier: user.email, password: strong72 })).status).toBe(200);
  });

  it('the administrator cannot set an over-long password either', async () => {
    const admin = await adminSession(app);
    const created = await admin.post('/api/admin/users', { name: 'Maria Santos', email: 'maria@evsu.edu.ph', password: strong73 });
    expect(created.status).toBe(422);
    expect(created.body.error.details[0]).toMatchObject({ field: 'password', message: expect.stringMatching(/at most 72 bytes/) });
    const teacher = await createUser();
    expect((await admin.put(`/api/admin/users/${teacher.id}/password`, { password: accented })).status).toBe(422);
    expect((await admin.put(`/api/admin/users/${teacher.id}/password`, { password: strong72 })).status).toBe(200);
  });
});
