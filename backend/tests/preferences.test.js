import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession } from './helpers/factories.js';

useTestDatabase();
const app = createApp();
const patch = (me, body) => request(app).patch('/api/auth/me/preferences').set(me.headers).send(body);

describe('PATCH /api/auth/me/preferences', () => {
  it('defaults to a shared working class and can turn it off and on', async () => {
    const me = await instructorSession(app);
    expect((await me.get('/api/auth/me')).body.data.user.preferences).toEqual({ workingClass: true });

    const off = await patch(me, { workingClass: false });
    expect(off.status).toBe(200);
    expect(off.body.data.user.preferences).toEqual({ workingClass: false });
    // Remembered for the next session (the user object comes back on every sign-in and refresh).
    expect((await me.get('/api/auth/me')).body.data.user.preferences.workingClass).toBe(false);

    expect((await patch(me, { workingClass: true })).body.data.user.preferences.workingClass).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'AUTH_PREFERENCES_UPDATE', user: me.user._id })).toBe(2);
  });

  it('accepts only true or false, and needs a signed-in user', async () => {
    const me = await instructorSession(app);
    expect((await patch(me, { workingClass: 'no' })).status).toBe(422);
    expect((await request(app).patch('/api/auth/me/preferences').send({ workingClass: false })).status).toBe(401);
  });
});
