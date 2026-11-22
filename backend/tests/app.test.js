import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /api/health', () => {
  it('reports degraded (503) with database status when MongoDB is not connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'degraded', database: 'disconnected' });
    expect(res.body.data.timestamp).toBeTypeOf('string');
  });

  it('does not leak environment details', async () => {
    const res = await request(app).get('/api/health');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/mongodb|secret|jwt/i);
  });
});

describe('error handling', () => {
  it('returns a JSON 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist?x=1');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route GET /api/does-not-exist not found' },
    });
    expect(res.body.error.requestId).toBeTypeOf('string');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
  });
});

describe('security middleware', () => {
  it('rejects MongoDB operator keys in the body', async () => {
    const res = await request(app).post('/api/health').send({ email: { $gt: '' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ source: 'body', field: 'email.$gt' });
  });

  it('rejects operator keys in the query string', async () => {
    const res = await request(app).get('/api/health?$where=1');
    expect(res.status).toBe(400);
  });

  it('does not build nested objects from bracket query syntax', async () => {
    const res = await request(app).get('/api/health?email[$ne]=x');
    // "email[$ne]" stays a flat key; it contains no leading $ so it passes the guard as a plain string key,
    // and can never reach Mongo as an operator object.
    expect([200, 503]).toContain(res.status);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTypeOf('string');
  });

  it('allows CORS for the configured client origin only', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const blocked = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
