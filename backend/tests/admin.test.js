import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { useTestDatabase } from './helpers/db.js';
import { adminSession, instructorSession, loginAs, DEFAULT_PASSWORD, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();
const NEW_PASSWORD = 'Welcome-to-EVSU-2026';
const newInstructor = (overrides = {}) => ({ name: 'Maria Santos', email: 'maria.santos@evsu.edu.ph', password: NEW_PASSWORD, ...overrides });
const login = (identifier, password) => request(app).post('/api/auth/login').send({ identifier, password });

describe('administrator: instructor accounts', () => {
  it('creates an instructor who can sign in right away', async () => {
    const admin = await adminSession(app);
    const res = await admin.post('/api/admin/users', newInstructor({ email: 'Maria.Santos@EVSU.edu.ph', username: 'MSantos' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Maria Santos', email: 'maria.santos@evsu.edu.ph', username: 'msantos', role: 'INSTRUCTOR', status: 'ACTIVE', activeClasses: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Welcome-to/);

    const signIn = await login('msantos', NEW_PASSWORD);
    expect(signIn.status).toBe(200);
    expect(signIn.body.data.user.role).toBe('INSTRUCTOR');
    expect(await AuditLog.countDocuments({ action: 'USER_CREATE', user: admin.user._id })).toBe(1);
  });

  it('lists instructors and admins with their active class count (never students)', async () => {
    const admin = await adminSession(app);
    const teacher = await instructorSession(app);
    await teacher.post('/api/classes', validClass());
    const list = (await admin.get('/api/admin/users')).body.data;
    expect(list.map((u) => u.role).sort()).toEqual(['ADMIN', 'INSTRUCTOR']);
    expect(list.find((u) => u.role === 'INSTRUCTOR').activeClasses).toBe(1);
  });

  it('rejects weak passwords and duplicate emails or usernames', async () => {
    const admin = await adminSession(app);
    const weak = await admin.post('/api/admin/users', newInstructor({ password: 'short' }));
    expect(weak.status).toBe(422);
    expect(weak.body.error.details[0]).toMatchObject({ field: 'password', message: expect.stringMatching(/at least 12 characters/) });
    await admin.post('/api/admin/users', newInstructor({ username: 'msantos' }));
    expect((await admin.post('/api/admin/users', newInstructor())).body.error.details[0].field).toBe('email');
    expect((await admin.post('/api/admin/users', newInstructor({ email: 'other@evsu.edu.ph', username: 'msantos' }))).body.error.details[0].field).toBe('username');
  });

  it('disables an instructor (signed out everywhere, cannot sign in) and re-enables them', async () => {
    const admin = await adminSession(app);
    const teacher = await instructorSession(app);
    const { cookie } = await loginAs(app, teacher.user);
    const off = await admin.put(`/api/admin/users/${teacher.user.id}/status`, { status: 'DISABLED' });
    expect(off.body.data.status).toBe('DISABLED');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await login(teacher.user.email, DEFAULT_PASSWORD)).status).toBe(403);

    expect((await admin.put(`/api/admin/users/${teacher.user.id}/status`, { status: 'ACTIVE' })).body.data.status).toBe('ACTIVE');
    expect((await login(teacher.user.email, DEFAULT_PASSWORD)).status).toBe(200);
  });

  it('sets a new password for an instructor and signs out their sessions', async () => {
    const admin = await adminSession(app);
    const teacher = await instructorSession(app);
    const res = await admin.put(`/api/admin/users/${teacher.user.id}/password`, { password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(await RefreshToken.countDocuments({ user: teacher.user._id, revokedReason: 'PASSWORD_CHANGED' })).toBeGreaterThan(0);
    expect((await login(teacher.user.email, DEFAULT_PASSWORD)).status).toBe(401);
    expect((await login(teacher.user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('cannot disable or reset another administrator through these endpoints', async () => {
    const admin = await adminSession(app);
    const other = await adminSession(app);
    expect((await admin.put(`/api/admin/users/${other.user.id}/status`, { status: 'DISABLED' })).status).toBe(404);
    expect((await admin.put(`/api/admin/users/${admin.user.id}/password`, { password: NEW_PASSWORD })).status).toBe(404);
  });

  it('is closed to instructors, and the administrator has no class records', async () => {
    const teacher = await instructorSession(app);
    expect((await teacher.get('/api/admin/users')).status).toBe(403);
    expect((await teacher.post('/api/admin/users', newInstructor())).status).toBe(403);
    const admin = await adminSession(app);
    expect((await admin.get('/api/classes')).status).toBe(403);
    expect((await admin.get('/api/grading/configuration')).status).toBe(200); // reads the shared criteria
  });
});
