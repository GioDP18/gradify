import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser, loginAs, DEFAULT_PASSWORD } from './helpers/factories.js';

useTestDatabase();
const app = createApp();
const NEW_PASSWORD = 'Brand-New-Passw0rd!';

async function signedIn(overrides) {
  const user = await createUser(overrides);
  const { accessToken, cookie } = await loginAs(app, user);
  const auth = { Authorization: `Bearer ${accessToken}` };
  return {
    user,
    cookie,
    patch: (body) => request(app).patch('/api/auth/me').set(auth).send(body),
    changePassword: (body) => request(app).put('/api/auth/me/password').set(auth).set('Cookie', cookie).send(body),
  };
}

describe('PATCH /api/auth/me (own profile)', () => {
  it('updates the name without asking for the password', async () => {
    const me = await signedIn();
    const res = await me.patch({ name: '  Gio De la Peña ' });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ name: 'Gio De la Peña', email: me.user.email });
    expect(await AuditLog.countDocuments({ action: 'AUTH_PROFILE_UPDATE', user: me.user._id })).toBe(1);
  });

  it('requires the current password to change the email or username', async () => {
    const me = await signedIn();
    const missing = await me.patch({ email: 'new.address@evsu.test' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual([{ field: 'currentPassword', message: expect.stringMatching(/current password/i) }]);

    const wrong = await me.patch({ username: 'gio.dp', currentPassword: 'Wrong-password-1!' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details[0]).toMatchObject({ field: 'currentPassword', message: 'Current password is incorrect.' });

    const ok = await me.patch({ email: 'New.Address@EVSU.test', username: 'Gio.DP', currentPassword: DEFAULT_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ email: 'new.address@evsu.test', username: 'gio.dp' });
    // The new identifiers sign in.
    for (const identifier of ['new.address@evsu.test', 'gio.dp']) {
      expect((await request(app).post('/api/auth/login').send({ identifier, password: DEFAULT_PASSWORD })).status).toBe(200);
    }
  });

  it('removes the username when cleared', async () => {
    const me = await signedIn({ username: 'old.name' });
    const res = await me.patch({ username: '', currentPassword: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBeNull();
    expect((await User.findById(me.user._id)).username).toBeUndefined();
  });

  it('rejects an email or username that another account already uses', async () => {
    const other = await createUser({ username: 'taken.name' });
    const me = await signedIn();
    const email = await me.patch({ email: other.email, currentPassword: DEFAULT_PASSWORD });
    expect(email.status).toBe(422);
    expect(email.body.error.details[0]).toMatchObject({ field: 'email', message: 'Another account already uses this email.' });
    const username = await me.patch({ username: 'TAKEN.name', currentPassword: DEFAULT_PASSWORD });
    expect(username.body.error.details[0]).toMatchObject({ field: 'username', message: 'This username is already taken.' });
  });

  it('validates the fields and ignores anything else (role, status)', async () => {
    const me = await signedIn();
    const bad = await me.patch({ name: '', email: 'not-an-email', username: 'a b' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d) => d.field).sort()).toEqual(['email', 'name', 'username']);
    const sneaky = await me.patch({ name: 'Still Instructor', role: 'STUDENT', status: 'DISABLED' });
    expect(sneaky.status).toBe(200);
    expect(sneaky.body.data.user).toMatchObject({ role: 'INSTRUCTOR', status: 'ACTIVE' });
  });

  it('needs a signed-in user', async () => {
    expect((await request(app).patch('/api/auth/me').send({ name: 'X' })).status).toBe(401);
  });
});

describe('PUT /api/auth/me/password', () => {
  it('changes the password, keeps this session, and signs out every other session', async () => {
    const me = await signedIn();
    const elsewhere = await loginAs(app, me.user); // another browser
    const res = await me.changePassword({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.otherSessionsSignedOut).toBe(1);

    expect((await request(app).post('/api/auth/login').send({ identifier: me.user.email, password: DEFAULT_PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ identifier: me.user.email, password: NEW_PASSWORD })).status).toBe(200);

    expect((await request(app).post('/api/auth/refresh').set('Cookie', me.cookie)).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', elsewhere.cookie)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: me.user._id, revokedReason: 'PASSWORD_CHANGED' })).toBe(1);
    const audit = await AuditLog.findOne({ action: 'AUTH_PASSWORD_CHANGE', user: me.user._id }).lean();
    expect(JSON.stringify(audit)).not.toMatch(/Passw0rd|Battery/); // no password in the log
  });

  it('refuses a wrong current password, a weak password, or the same password', async () => {
    const me = await signedIn();
    const wrong = await me.changePassword({ currentPassword: 'Nope-nope-123!', newPassword: NEW_PASSWORD });
    expect(wrong.body.error.details[0]).toMatchObject({ field: 'currentPassword', message: 'Current password is incorrect.' });
    const weak = await me.changePassword({ currentPassword: DEFAULT_PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.details[0].field).toBe('newPassword');
    expect(weak.body.error.details[0].message).toMatch(/at least 12 characters/);
    const same = await me.changePassword({ currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD });
    expect(same.body.error.details[0]).toMatchObject({ field: 'newPassword', message: 'Choose a password different from your current one.' });
    expect((await request(app).post('/api/auth/login').send({ identifier: me.user.email, password: DEFAULT_PASSWORD })).status).toBe(200);
  });

  it('limits repeated wrong current-password attempts', async () => {
    const me = await signedIn();
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await me.changePassword({ currentPassword: `Wrong-guess-${i}!`, newPassword: NEW_PASSWORD })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 422)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
