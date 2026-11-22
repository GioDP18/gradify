/**
 * I-2: audit-log retention. Old IP addresses are removed, routine entries expire after a year,
 * and everything else after the configured period.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { applyAuditRetention, ROUTINE_ACTIONS } from '../src/services/auditRetention.service.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase();
const app = createApp();

const NOW = new Date('2026-11-23T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const DEFAULTS = { ipDays: 90, routineDays: 365, allDays: 1825 };

/** Inserts an entry with a chosen age (createdAt is otherwise set automatically). */
async function entry(action, ageDays, metadata = { ip: '203.0.113.9', userAgent: 'Test Browser', requestId: 'req-1' }) {
  const [doc] = await AuditLog.insertMany([{ action, affectedCollection: 'x', metadata, createdAt: daysAgo(ageDays) }]);
  return doc._id;
}
const find = (id) => AuditLog.findById(id).lean();

describe('applyAuditRetention', () => {
  it('removes IP and user agent from entries older than 90 days, and keeps the entry', async () => {
    const old = await entry('QUIZ_SCORES_UPDATE', 91);
    const recent = await entry('QUIZ_SCORES_UPDATE', 89);
    const result = await applyAuditRetention({ now: NOW, retention: DEFAULTS });

    expect(result.anonymized).toBe(1);
    expect((await find(old)).metadata).toEqual({ requestId: 'req-1' }); // other details stay
    expect((await find(old)).action).toBe('QUIZ_SCORES_UPDATE');
    expect((await find(recent)).metadata).toMatchObject({ ip: '203.0.113.9', userAgent: 'Test Browser' });

    // Running it again changes nothing more.
    expect((await applyAuditRetention({ now: NOW, retention: DEFAULTS })).anonymized).toBe(0);
  });

  it('deletes routine entries after a year, but keeps academic and security entries', async () => {
    const routine = await Promise.all(ROUTINE_ACTIONS.map((action) => entry(action, 366)));
    const recentLogin = await entry('AUTH_LOGIN', 364);
    const kept = await Promise.all(
      ['QUIZ_SCORES_UPDATE', 'ATTENDANCE_RECORDS_UPDATE', 'ENROLLMENT_SELF', 'GRADING_CONFIG_VERSION', 'GRADE_INC_LAPSED', 'AUTH_ACCOUNT_LOCKED', 'AUTH_PASSWORD_CHANGE', 'USER_CREATE']
        .map((action) => entry(action, 366)),
    );
    const result = await applyAuditRetention({ now: NOW, retention: DEFAULTS });

    expect(result.routineDeleted).toBe(ROUTINE_ACTIONS.length);
    for (const id of routine) expect(await find(id)).toBeNull();
    expect(await find(recentLogin)).not.toBeNull();
    for (const id of kept) expect(await find(id)).not.toBeNull();
  });

  it('deletes every entry older than the full period (5 years by default)', async () => {
    const expired = await entry('QUIZ_SCORES_UPDATE', 1826);
    const inside = await entry('QUIZ_SCORES_UPDATE', 1824);
    const result = await applyAuditRetention({ now: NOW, retention: DEFAULTS });
    expect(result.expiredDeleted).toBe(1);
    expect(await find(expired)).toBeNull();
    expect(await find(inside)).not.toBeNull();
  });

  it('0 means keep forever, for each rule separately', async () => {
    const ancient = await entry('AUTH_LOGIN', 5000);
    const untouched = await applyAuditRetention({ now: NOW, retention: { ipDays: 0, routineDays: 0, allDays: 0 } });
    expect(untouched).toEqual({ anonymized: 0, routineDeleted: 0, expiredDeleted: 0 });
    expect((await find(ancient)).metadata.ip).toBe('203.0.113.9');

    await applyAuditRetention({ now: NOW, retention: { ipDays: 30, routineDays: 0, allDays: 0 } });
    expect((await find(ancient)).metadata.ip).toBeUndefined(); // anonymized only
    expect(await find(ancient)).not.toBeNull();
  });

  it('handles entries without request details', async () => {
    const id = await entry('GRADE_INC_LAPSED', 200, {});
    await applyAuditRetention({ now: NOW, retention: DEFAULTS });
    expect(await find(id)).not.toBeNull();
  });
});

describe('scheduled sweep', () => {
  it('applies retention with the configured periods and reports what it did', async () => {
    const oldLogin = await AuditLog.insertMany([{ action: 'AUTH_LOGIN', affectedCollection: 'users', metadata: { ip: '203.0.113.9' }, createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) }]);
    const res = await request(app).get('/api/internal/sweep').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('classes');
    expect(res.body.data.audit).toEqual({ anonymized: 1, routineDeleted: 1, expiredDeleted: 0 });
    expect(await AuditLog.findById(oldLogin[0]._id)).toBeNull();
  });
});

describe('retention configuration', () => {
  const base = { MONGODB_URI: 'mongodb://127.0.0.1:27017/', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };

  it('defaults to 90 / 365 / 1825 days and accepts 0', () => {
    expect(loadConfig(base).auditRetention).toEqual({ ipDays: 90, routineDays: 365, allDays: 1825 });
    expect(loadConfig({ ...base, AUDIT_IP_RETENTION_DAYS: '0', AUDIT_ROUTINE_RETENTION_DAYS: '30', AUDIT_RETENTION_DAYS: '3650' }).auditRetention)
      .toEqual({ ipDays: 0, routineDays: 30, allDays: 3650 });
  });

  it.each(['AUDIT_IP_RETENTION_DAYS', 'AUDIT_ROUTINE_RETENTION_DAYS', 'AUDIT_RETENTION_DAYS'])('rejects invalid %s', (name) => {
    for (const bad of ['abc', '-1', '1.5', '36501']) {
      expect(() => loadConfig({ ...base, [name]: bad })).toThrowError(new RegExp(`${name} must be an integer between 0 and 36500`));
    }
  });
});
