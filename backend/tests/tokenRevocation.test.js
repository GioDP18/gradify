/**
 * L-1: access tokens are revoked at once (tokenVersion), and logout always ends the session.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { useTestDatabase } from './helpers/db.js';
import { adminSession, createUser, loginAs, DEFAULT_PASSWORD } from './helpers/factories.js';

useTestDatabase();
const app = createApp();
const NEW_PASSWORD = 'Brand-New-Passw0rd!';
const ORIGIN = 'http://localhost:5173';

const me = (accessToken) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
const refresh = (cookie) => request(app).post('/api/auth/refresh').set('Cookie', cookie).set('Origin', ORIGIN);

describe('logout', () => {
  it('ends the session even when the browser sends a JSON body of null (regression)', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(app, user);
    // Exactly what the web app used to send; the JSON parser refused it with 400, so the
    // session survived "logging out" and a page reload signed the user back in.
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN).set('Content-Type', 'application/json').send('null');
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'][0]).toMatch(/evsu_rt=;/);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('also works with malformed JSON or no body at all', async () => {
    for (const send of [(r) => r.set('Content-Type', 'application/json').send('{not json'), (r) => r]) {
      const { cookie } = await loginAs(app, await createUser());
      const res = await send(request(app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN));
      expect(res.status).toBe(204);
      expect((await refresh(cookie)).status).toBe(401);
    }
  });

  it('refuses the access token straight away, not when it expires', async () => {
    const user = await createUser();
    const { accessToken, cookie } = await loginAs(app, user);
    expect((await me(accessToken)).status).toBe(200);
    await request(app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN);
    const after = await me(accessToken);
    expect(after.status).toBe(401);
    expect(after.body.error.message).toBe('Session expired. Please sign in again.');
  });

  it('leaves the account\'s other devices signed in: they refresh and continue', async () => {
    const user = await createUser();
    const here = await loginAs(app, user);
    const elsewhere = await loginAs(app, user);
    await request(app).post('/api/auth/logout').set('Cookie', here.cookie).set('Origin', ORIGIN);
    expect((await me(elsewhere.accessToken)).status).toBe(401); // its old access token is refused…
    const renewed = await refresh(elsewhere.cookie); // …but its own refresh cookie still works
    expect(renewed.status).toBe(200);
    expect((await me(renewed.body.data.accessToken)).status).toBe(200);
  });

  it('a logout request without a valid session cookie changes nothing', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(app, user);
    await request(app).post('/api/auth/logout').set('Cookie', 'evsu_rt=not-a-real-token').set('Origin', ORIGIN);
    expect((await me(accessToken)).status).toBe(200);
    expect((await User.findById(user._id)).tokenVersion).toBe(0);
  });
});

describe('password change', () => {
  it('refuses access tokens issued before it, and keeps the current session working', async () => {
    const user = await createUser();
    const current = await loginAs(app, user);
    const stolen = await loginAs(app, user); // e.g. a copied token on another device

    const res = await request(app).put('/api/auth/me/password')
      .set('Authorization', `Bearer ${current.accessToken}`).set('Cookie', current.cookie).set('Origin', ORIGIN)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    expect((await me(stolen.accessToken)).status).toBe(401);
    expect((await me(current.accessToken)).status).toBe(401); // the old token of this session too
    // The session that changed the password continues: new access token, same refresh cookie.
    expect((await me(res.body.data.accessToken)).status).toBe(200);
    expect((await refresh(current.cookie)).status).toBe(200);
    expect((await refresh(stolen.cookie)).status).toBe(401);
  });
});

describe('administrator actions', () => {
  it('a password reset refuses the instructor\'s existing access tokens', async () => {
    const admin = await adminSession(app);
    const teacher = await createUser();
    const { accessToken } = await loginAs(app, teacher);
    expect((await admin.put(`/api/admin/users/${teacher.id}/password`, { password: NEW_PASSWORD })).status).toBe(200);
    expect((await me(accessToken)).status).toBe(401);
    expect((await me(admin.headers.Authorization.slice(7))).status).toBe(200); // the admin is unaffected
  });

  it('disabling an account raises its token version, so tokens stay dead after re-enabling', async () => {
    const admin = await adminSession(app);
    const teacher = await createUser();
    const { accessToken } = await loginAs(app, teacher);
    await admin.put(`/api/admin/users/${teacher.id}/status`, { status: 'DISABLED' });
    expect((await me(accessToken)).status).toBe(401);
    await admin.put(`/api/admin/users/${teacher.id}/status`, { status: 'ACTIVE' });
    expect((await me(accessToken)).status).toBe(401);
    expect((await User.findById(teacher._id)).tokenVersion).toBe(1);
  });
});

describe('token version', () => {
  it('is carried in the access token as tv', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(app, user);
    expect(jwt.decode(accessToken)).toMatchObject({ tv: 0, role: 'INSTRUCTOR' });
  });

  it('accepts tokens issued before this change (no tv) until the account\'s version is raised', async () => {
    const user = await createUser();
    const legacy = jwt.sign({ role: user.role }, process.env.JWT_ACCESS_SECRET, { subject: user._id.toString(), expiresIn: '15m', algorithm: 'HS256', issuer: 'evsu-grading-system' });
    expect((await me(legacy)).status).toBe(200);
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    expect((await me(legacy)).status).toBe(401);
  });
});
