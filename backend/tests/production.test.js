/**
 * Production / Vercel readiness: configuration rules, the serverless entry point, the cron
 * endpoint, and the MongoDB-backed rate-limit store shared by serverless instances.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { MongoRateLimitStore } from '../src/middleware/mongoRateLimitStore.js';
import { RateLimitHit } from '../src/models/RateLimitHit.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser } from './helpers/factories.js';

useTestDatabase();

const base = {
  MONGODB_URI: 'mongodb+srv://u:p@cluster.example.net/',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  CLIENT_URL: 'https://grades.example.edu',
};

describe('production configuration', () => {
  it('requires TRUST_PROXY to be set explicitly in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrowError(/TRUST_PROXY must be set explicitly/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).trustProxy).toBe(0);
  });

  it('requires a long CRON_SECRET when one is set', () => {
    expect(() => loadConfig({ ...base, CRON_SECRET: 'short' })).toThrowError(/CRON_SECRET must be at least 32/);
    expect(loadConfig(base).cronSecret).toBeNull();
  });

  it('allows disabling the per-IP login limit', () => {
    expect(loadConfig({ ...base, LOGIN_IP_RATE_LIMIT: '0' }).loginIpRateLimit).toBe(0);
    expect(loadConfig(base).loginIpRateLimit).toBe(50);
  });

  it('validates SELF_ENROLL_IP_LIMIT (default 150, 0 disables it)', () => {
    expect(loadConfig(base).selfEnrollIpLimit).toBe(150);
    expect(loadConfig({ ...base, SELF_ENROLL_IP_LIMIT: '0' }).selfEnrollIpLimit).toBe(0);
    expect(loadConfig({ ...base, SELF_ENROLL_IP_LIMIT: '40' }).selfEnrollIpLimit).toBe(40);
    for (const bad of ['abc', '-1', '1.5', '10001']) {
      expect(() => loadConfig({ ...base, SELF_ENROLL_IP_LIMIT: bad })).toThrowError(/SELF_ENROLL_IP_LIMIT must be an integer between 0 and 10000/);
    }
  });
});

describe('Vercel serverless entry point (api/index.js)', () => {
  it('serves the API with a ready database connection', async () => {
    const { default: handler } = await import('../api/index.js');
    const res = await request(handler).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('connected');
  });

  it('serves the full API (e.g. auth) through the same handler', async () => {
    const { default: handler } = await import('../api/index.js');
    const res = await request(handler).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('cron sweep endpoint', () => {
  it('requires the cron secret', async () => {
    const { default: handler } = await import('../api/index.js');
    expect((await request(handler).get('/api/internal/sweep')).status).toBe(401);
    expect((await request(handler).get('/api/internal/sweep').set('Authorization', 'Bearer wrong')).status).toBe(401);
    const ok = await request(handler).get('/api/internal/sweep').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveProperty('classes');
  });

  it('cannot be reached with an instructor login', async () => {
    const { default: handler } = await import('../api/index.js');
    const user = await createUser();
    const login = await request(handler).post('/api/auth/login').send({ identifier: user.email, password: 'Correct-Horse-9-Battery' });
    const res = await request(handler).get('/api/internal/sweep').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(401);
  });
});

describe('MongoDB rate-limit store', () => {
  it('counts hits in a shared window, decrements, resets, and starts a new window after expiry', async () => {
    const storeA = new MongoRateLimitStore({ prefix: 't' });
    const storeB = new MongoRateLimitStore({ prefix: 't' }); // a second "serverless instance"
    storeA.init({ windowMs: 60_000 });
    storeB.init({ windowMs: 60_000 });

    expect((await storeA.increment('k')).totalHits).toBe(1);
    expect((await storeB.increment('k')).totalHits).toBe(2); // shared across instances
    await storeA.decrement('k');
    expect((await storeB.increment('k')).totalHits).toBe(2);

    await RateLimitHit.updateOne({ _id: 't:k' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const fresh = await storeA.increment('k');
    expect(fresh.totalHits).toBe(1);
    expect(fresh.resetTime.getTime()).toBeGreaterThan(Date.now());

    await storeA.resetKey('k');
    expect(await RateLimitHit.countDocuments()).toBe(0);
  });

  it('is atomic under concurrent increments', async () => {
    const store = new MongoRateLimitStore({ prefix: 'c' });
    store.init({ windowMs: 60_000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => store.increment('k')));
    expect(results.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
