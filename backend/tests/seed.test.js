import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { User, ROLES } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { seedDatabaseIfEmpty, isDatabaseEmpty } from '../src/services/seed.service.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser } from './helpers/factories.js';

useTestDatabase();

const admin = { name: 'Registrar', email: 'registrar@evsu.test', username: 'registrar', password: 'Seed-Me-Once-2026!' };
const on = { enabled: true, admin };

describe('SEED_DATABASE setting', () => {
  const base = { NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27017/', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };
  const seedVars = { SEED_ADMIN_EMAIL: 'Registrar@EVSU.test', SEED_ADMIN_PASSWORD: admin.password };

  it('is off unless it is exactly "true"', () => {
    expect(loadConfig(base).seed.enabled).toBe(false); // variable missing
    expect(loadConfig({ ...base, SEED_DATABASE: '' }).seed.enabled).toBe(false);
    expect(loadConfig({ ...base, SEED_DATABASE: 'false' }).seed.enabled).toBe(false);
    expect(loadConfig({ ...base, SEED_DATABASE: 'true', ...seedVars }).seed).toMatchObject({ enabled: true, admin: { name: 'Administrator', email: 'registrar@evsu.test' } });
    expect(() => loadConfig({ ...base, SEED_DATABASE: 'yes' })).toThrowError(/SEED_DATABASE must be "true" or "false"/);
  });

  it('needs the administrator email and password only when it is on', () => {
    expect(() => loadConfig({ ...base, SEED_DATABASE: 'true' })).toThrowError(/SEED_ADMIN_EMAIL[\s\S]*SEED_ADMIN_PASSWORD/);
    expect(() => loadConfig({ ...base, SEED_DATABASE: 'false', SEED_ADMIN_EMAIL: 'nope' })).not.toThrow();
  });
});

describe('seeding an empty database', () => {
  it('does nothing when seeding is off', async () => {
    expect(await seedDatabaseIfEmpty({ enabled: false, admin })).toEqual({ seeded: false, reason: 'disabled' });
    expect(await seedDatabaseIfEmpty(undefined ?? { enabled: false })).toEqual({ seeded: false, reason: 'disabled' });
    expect(await isDatabaseEmpty()).toBe(true);
  });

  it('creates the administrator, who can then sign in', async () => {
    expect(await seedDatabaseIfEmpty(on)).toEqual({ seeded: true });
    const user = await User.findOne({ email: admin.email }).select('+passwordHash').lean();
    expect(user).toMatchObject({ name: 'Registrar', username: 'registrar', role: ROLES.ADMIN });
    expect(user.passwordHash).not.toContain(admin.password);
    expect(await AuditLog.countDocuments({ action: 'USER_CREATE_SEED' })).toBe(1);

    const login = await request(createApp()).post('/api/auth/login').send({ identifier: admin.email, password: admin.password });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe(ROLES.ADMIN);
  });

  it('seeds only once, and never touches a database that already has accounts', async () => {
    await seedDatabaseIfEmpty(on);
    expect(await seedDatabaseIfEmpty({ enabled: true, admin: { ...admin, email: 'second@evsu.test', username: 'second' } })).toEqual({ seeded: false, reason: 'not-empty' });
    expect(await User.countDocuments()).toBe(1);
  });

  it('leaves existing data alone', async () => {
    const existing = await createUser();
    expect(await seedDatabaseIfEmpty(on)).toEqual({ seeded: false, reason: 'not-empty' });
    expect((await User.find().lean()).map((u) => u.email)).toEqual([existing.email]);
  });

  it('refuses a weak administrator password and creates nothing', async () => {
    await expect(seedDatabaseIfEmpty({ enabled: true, admin: { ...admin, password: 'alllowercase123' } })).rejects.toThrow(/SEED_ADMIN_PASSWORD/);
    expect(await isDatabaseEmpty()).toBe(true);
  });

  it('two instances starting together create one administrator', async () => {
    const results = await Promise.all([seedDatabaseIfEmpty(on), seedDatabaseIfEmpty(on)]);
    expect(results.filter((r) => r.seeded)).toHaveLength(1);
    expect(await User.countDocuments()).toBe(1);
  });
});
