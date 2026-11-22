import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { User, ROLES, USER_STATUSES } from '../src/models/User.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { MAX_FAILED_LOGINS, ROTATION_GRACE_MS } from '../src/services/auth.service.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser, loginAs, DEFAULT_PASSWORD } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

/** A login attempt as seen from one client IP (tests run with TRUST_PROXY=1). */
const loginFrom = (ip, identifier, password) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ identifier, password });

function cookieFrom(res) {
  return res.headers['set-cookie']?.find((c) => c.startsWith('evsu_rt='))?.split(';')[0];
}

describe('POST /api/auth/login', () => {
  it('logs in by email or username and sets a secure HttpOnly refresh cookie', async () => {
    const user = await createUser({ username: 'jdelacruz' });

    const byEmail = await request(app).post('/api/auth/login').send({ identifier: user.email.toUpperCase(), password: DEFAULT_PASSWORD });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.user).toMatchObject({ email: user.email, role: 'INSTRUCTOR' });
    expect(byEmail.body.data.user.passwordHash).toBeUndefined();
    expect(byEmail.body.data.accessToken).toBeTypeOf('string');
    const setCookie = byEmail.headers['set-cookie'][0];
    expect(setCookie).toMatch(/evsu_rt=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api\/auth/);
    expect(setCookie).not.toMatch(/Expires=/); // session cookie without "remember me"

    const byUsername = await request(app).post('/api/auth/login').send({ identifier: 'jdelacruz', password: DEFAULT_PASSWORD });
    expect(byUsername.status).toBe(200);
  });

  it('issues a persistent cookie with "remember me"', async () => {
    const user = await createUser();
    const { res } = await loginAs(app, user, { remember: true });
    expect(res.headers['set-cookie'][0]).toMatch(/Expires=/);
  });

  it('stores only a hash of the refresh token', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    const raw = cookie.split('=')[1];
    const stored = await RefreshToken.findOne({ user: user._id });
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives the same message for unknown accounts and wrong passwords', async () => {
    const user = await createUser();
    const unknown = await request(app).post('/api/auth/login').send({ identifier: 'nobody@evsu.test', password: 'whatever' });
    const wrong = await request(app).post('/api/auth/login').send({ identifier: user.email, password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('validates input', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: '', remember: 'yes' });
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['identifier', 'password', 'remember']));
  });

  it('rejects NoSQL operator payloads', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} failed attempts from many networks, even for the right password`, async () => {
    const user = await createUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      expect((await loginFrom(`203.0.113.${i + 1}`, user.email, 'wrong-password')).status).toBe(401);
    }
    const locked = await loginFrom('198.51.100.7', user.email, DEFAULT_PASSWORD);
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await AuditLog.countDocuments({ action: 'AUTH_ACCOUNT_LOCKED' })).toBe(1);
  });

  it('one network cannot lock an account: the owner still signs in from another network (M-1)', async () => {
    const user = await createUser();
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await loginFrom('203.0.113.1', user.email, 'wrong-password')).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429); // that network is now refused for this account,
    expect((await loginFrom('203.0.113.1', user.email, DEFAULT_PASSWORD)).status).toBe(429); // even with the right password

    const owner = await loginFrom('198.51.100.7', user.email, DEFAULT_PASSWORD);
    expect(owner.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'AUTH_ACCOUNT_LOCKED' })).toBe(0);
  });

  it('counts failures per network and per account separately', async () => {
    const [victim, other] = [await createUser(), await createUser()];
    for (let i = 0; i < 10; i += 1) await loginFrom('203.0.113.1', victim.email, 'wrong-password');
    expect((await loginFrom('203.0.113.1', victim.email, 'wrong-password')).status).toBe(429);
    // The same network can still sign in to a different account (the per-IP limit of 50 covers spraying).
    expect((await loginFrom('203.0.113.1', other.email, DEFAULT_PASSWORD)).status).toBe(200);
  });

  it('resets the failure counter after a successful login', async () => {
    const user = await createUser();
    for (let i = 0; i < 4; i += 1) {
      await request(app).post('/api/auth/login').send({ identifier: user.email, password: 'wrong-password' });
    }
    expect((await User.findById(user._id).select('+failedLoginCount')).failedLoginCount).toBe(4);
    await loginAs(app, user);
    const fresh = await User.findById(user._id).select('+failedLoginCount');
    expect(fresh.failedLoginCount).toBe(0);
  });

  it('refuses disabled accounts', async () => {
    const user = await createUser({ status: USER_STATUSES.DISABLED });
    const res = await request(app).post('/api/auth/login').send({ identifier: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rate-limits repeated failures for the same identifier', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app).post('/api/auth/login').send({ identifier: 'ratelimit@evsu.test', password: 'x' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('refuses logins from untrusted browser origins', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ identifier: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    const newCookie = cookieFrom(res);
    expect(newCookie).toBeDefined();
    expect(newCookie).not.toBe(cookie);

    const again = await request(app).post('/api/auth/refresh').set('Cookie', newCookie);
    expect(again.status).toBe(200);
  });

  it('treats an immediate second use as a benign race, but a late replay as theft', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    const rotated = cookieFrom(first);

    const race = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(race.status).toBe(401);
    expect(race.body.error.code).toBe('REFRESH_RACE');

    // Simulate a replay after the grace window.
    await RefreshToken.updateMany({ revokedReason: 'ROTATED' }, { $set: { revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) } });
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHORIZED');

    // The legitimate (rotated) session is now revoked too.
    const victim = await request(app).post('/api/auth/refresh').set('Cookie', rotated);
    expect(victim.status).toBe(401);
    expect(await AuditLog.countDocuments({ action: 'AUTH_REFRESH_REUSE' })).toBe(1);
  });

  it('returns 401 without a cookie or with a garbage token', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', 'evsu_rt=garbage')).status).toBe(401);
  });

  it('ends sessions of accounts disabled after login', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    await User.updateOne({ _id: user._id }, { status: USER_STATUSES.DISABLED });
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('refuses refresh from an untrusted origin (CSRF)', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/evsu_rt=;/);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('GET /api/auth/me and authentication', () => {
  it('returns the current user for a valid access token', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(app, user);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: user._id.toString(), role: 'INSTRUCTOR' });
  });

  it('rejects missing, malformed, forged, and expired tokens', async () => {
    const user = await createUser();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);

    const forged = jwt.sign({ role: 'INSTRUCTOR' }, 'not-the-real-secret-not-the-real-secret', { subject: user._id.toString(), issuer: 'evsu-grading-system' });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);

    const expired = jwt.sign({ role: 'INSTRUCTOR' }, process.env.JWT_ACCESS_SECRET, {
      subject: user._id.toString(), issuer: 'evsu-grading-system', expiresIn: -10,
    });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects "none"-algorithm tokens', async () => {
    const user = await createUser();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: user._id.toString(), role: 'INSTRUCTOR', iss: 'evsu-grading-system' })).toString('base64url');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${header}.${payload}.`);
    expect(res.status).toBe(401);
  });

  it('uses the role stored in the database, not the one in the token', async () => {
    const student = await createUser({ role: ROLES.STUDENT });
    // A token claiming INSTRUCTOR for a STUDENT account (e.g. issued before a role change).
    const token = jwt.sign({ role: 'INSTRUCTOR' }, process.env.JWT_ACCESS_SECRET, {
      subject: student._id.toString(), issuer: 'evsu-grading-system', expiresIn: '5m',
    });
    const res = await request(app).get('/api/classes').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('student role', () => {
  it('can authenticate and call /me, but is forbidden from instructor endpoints', async () => {
    const student = await createUser({ role: ROLES.STUDENT });
    const { accessToken } = await loginAs(app, student);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.body.data.user.role).toBe('STUDENT');
    const res = await request(app).get('/api/classes').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('audit logging', () => {
  it('records logins without any secrets', async () => {
    vi.useRealTimers();
    const user = await createUser();
    await loginAs(app, user);
    const entry = await AuditLog.findOne({ action: 'AUTH_LOGIN' }).lean();
    expect(entry.user.toString()).toBe(user._id.toString());
    expect(JSON.stringify(entry)).not.toMatch(/password|evsu_rt|Bearer/i);
  });
});
