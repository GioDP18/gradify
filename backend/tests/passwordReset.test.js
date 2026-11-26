import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { PasswordReset } from '../src/models/PasswordReset.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { setMailTransportForTests } from '../src/services/mail.service.js';
import { MAX_REQUESTS_PER_HOUR } from '../src/services/passwordReset.service.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser, loginAs, DEFAULT_PASSWORD } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

const NEW_PASSWORD = 'Brand-New-Passw0rd!';
let user;
let sent;
let ipCounter = 0;
// Each call comes from its own network unless told otherwise, so the per-network limit stays out of the way.
const post = (path, body, ip) => { ipCounter += 1; return request(app).post(`/api/auth/password${path}`).set('X-Forwarded-For', ip ?? `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`).send(body); };
const forgot = (email, ip) => post('/forgot', { email }, ip);
const tokenFrom = (message) => /\/reset-password\/([A-Za-z0-9_-]+)/.exec(message.text)[1];
async function requestLink(email = user.email) {
  await forgot(email);
  return tokenFrom(sent.at(-1));
}

beforeEach(async () => {
  user = await createUser({ name: 'Maria Santos', email: 'maria@evsu.test' });
  sent = [];
  setMailTransportForTests({ sendMail: async (message) => { sent.push(message); } });
});
afterEach(() => setMailTransportForTests(null));

describe('asking for a reset link', () => {
  it('emails a single-use link, storing only a hash of it', async () => {
    const res = await forgot('  Maria@EVSU.test ');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('maria@evsu.test');
    expect(sent[0].subject).toBe('Reset your Gradify password');
    expect(sent[0].text).toMatch(/works once and only for 30 minutes/);

    const token = tokenFrom(sent[0]);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sent[0].text).toContain(`http://localhost:5173/reset-password/${token}`);
    const [record] = await PasswordReset.find().lean();
    expect(record.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain(token);
    expect(record.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(record.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(await AuditLog.countDocuments({ action: 'AUTH_PASSWORD_RESET_REQUEST' })).toBe(1);
  });

  it('answers the same for unknown and disabled accounts, and sends them nothing', async () => {
    const known = await forgot(user.email);
    const unknown = await forgot('nobody@evsu.test');
    const disabledUser = await createUser({ email: 'off@evsu.test', status: 'DISABLED' });
    const disabled = await forgot(disabledUser.email);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(disabled.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
    expect(await PasswordReset.countDocuments()).toBe(1);
  });

  it('a new link cancels the earlier one, and each account gets only a few per hour', async () => {
    const first = await requestLink();
    const second = await requestLink();
    expect((await post('/reset/check', { token: first })).body.data).toEqual({ valid: false });
    expect((await post('/reset/check', { token: second })).body.data).toEqual({ valid: true });

    for (let i = 2; i < MAX_REQUESTS_PER_HOUR + 2; i += 1) expect((await forgot(user.email)).status).toBe(200);
    expect(sent).toHaveLength(MAX_REQUESTS_PER_HOUR); // further requests look the same but send nothing
    expect(await AuditLog.countDocuments({ action: 'AUTH_PASSWORD_RESET_THROTTLED' })).toBe(2);
  });

  it('limits requests from one network, refuses foreign sites, and hides mail failures', async () => {
    for (let i = 0; i < 5; i += 1) expect((await forgot('nobody@evsu.test', '10.1.1.1')).status).toBe(200);
    expect((await forgot('nobody@evsu.test', '10.1.1.1')).status).toBe(429);
    expect((await request(app).post('/api/auth/password/forgot').set('Origin', 'https://evil.example').send({ email: user.email })).status).toBe(403);
    expect((await forgot('not-an-email')).status).toBe(422);

    setMailTransportForTests({ sendMail: async () => { throw new Error('ECONNREFUSED'); } });
    const failed = await forgot(user.email);
    expect(failed.status).toBe(200);
    expect(failed.body.data.message).toMatch(/If an account uses that email/);
  });

  it('says so plainly when email is not set up, without touching any account', async () => {
    setMailTransportForTests(null);
    const res = await forgot(user.email);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/administrator/);
    expect(await PasswordReset.countDocuments()).toBe(0);
  });
});

describe('choosing a new password', () => {
  it('changes the password once, signs out every device, clears a lock, and tells the owner', async () => {
    const session = await loginAs(app, user);
    await User.updateOne({ _id: user._id }, { failedLoginCount: 7, lockUntil: new Date(Date.now() + 600000) });
    const token = await requestLink();

    const res = await post('/reset', { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ message: 'Your password has been changed. Sign in with your new password.' });
    expect(res.headers['set-cookie']).toBeUndefined(); // the link itself signs nobody in

    // Old password and old sessions are dead; the new password works.
    expect((await request(app).post('/api/auth/login').send({ identifier: user.email, password: DEFAULT_PASSWORD })).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', session.cookie)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: user._id, revokedAt: null })).toBe(0);
    expect((await request(app).post('/api/auth/login').send({ identifier: user.email, password: NEW_PASSWORD })).status).toBe(200);

    // The link cannot be used again.
    expect((await post('/reset/check', { token })).body.data).toEqual({ valid: false });
    const again = await post('/reset', { token, newPassword: 'Another-Passw0rd!!' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('RESET_LINK_INVALID');

    expect(sent.at(-1).subject).toBe('Your Gradify password was changed');
    expect(await AuditLog.countDocuments({ action: 'AUTH_PASSWORD_RESET' })).toBe(1);
  });

  it('rejects weak or unchanged passwords without using up the link', async () => {
    const token = await requestLink();
    const weak = await post('/reset', { token, newPassword: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.details[0]).toMatchObject({ field: 'newPassword' });
    const same = await post('/reset', { token, newPassword: DEFAULT_PASSWORD });
    expect(same.status).toBe(422);
    expect(same.body.error.details[0].message).toMatch(/different from your current one/);
    expect((await post('/reset', { token, newPassword: NEW_PASSWORD })).status).toBe(200);
  });

  it('refuses expired, unknown and tampered links, and links of accounts disabled since', async () => {
    const expired = await requestLink();
    await PasswordReset.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await post('/reset', { token: expired, newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await post('/reset', { token: 'A'.repeat(43), newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await post('/reset', { token: `${expired.slice(0, -1)}${expired.endsWith('A') ? 'B' : 'A'}`, newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await post('/reset', { newPassword: NEW_PASSWORD })).status).toBe(422);

    const token = await requestLink();
    await User.updateOne({ _id: user._id }, { status: 'DISABLED' });
    expect((await post('/reset/check', { token })).body.data).toEqual({ valid: false });
    expect((await post('/reset', { token, newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it('lets only one of two simultaneous submissions through', async () => {
    const token = await requestLink();
    const results = await Promise.all([post('/reset', { token, newPassword: NEW_PASSWORD }), post('/reset', { token, newPassword: 'Other-New-Passw0rd!' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
});
