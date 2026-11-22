import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Student } from '../src/models/Student.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { RateLimitHit } from '../src/models/RateLimitHit.js';
import { env } from '../src/config/env.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validClass, validStudent } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
const form = (overrides = {}) => ({ studentNumber: '2025-00777', lastName: 'Rizal', firstName: 'José', middleName: 'Protasio', course: 'BSIT', yearLevel: 1, section: 'A', ...overrides });
const join = (token) => request(app).get(`/api/public/enroll/${token}`);
const enroll = (token, body) => request(app).post(`/api/public/enroll/${token}`).send(body);
async function open() {
  const res = await me.put(`/api/classes/${cls.id}/self-enrollment`, { open: true });
  return res.body.data.selfEnrollment.token;
}

beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
});

describe('instructor controls', () => {
  it('is off by default; turning it on creates a private link; it can be turned off', async () => {
    expect(cls.selfEnrollment).toEqual({ open: false, token: null });
    const token = await open();
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const closed = await me.put(`/api/classes/${cls.id}/self-enrollment`, { open: false });
    expect(closed.body.data.selfEnrollment).toEqual({ open: false, token }); // same link, just closed
    expect(await AuditLog.countDocuments({ action: { $in: ['CLASS_SELF_ENROLL_OPEN', 'CLASS_SELF_ENROLL_CLOSE'] } })).toBe(2);
  });

  it('a new link makes the old QR code stop working', async () => {
    const old = await open();
    const fresh = (await me.post(`/api/classes/${cls.id}/self-enrollment/link`)).body.data.selfEnrollment.token;
    expect(fresh).not.toBe(old);
    expect((await join(old)).status).toBe(404);
    expect((await join(fresh)).body.data.open).toBe(true);
  });

  it('only the class owner can change it', async () => {
    const other = await instructorSession(app);
    expect((await other.put(`/api/classes/${cls.id}/self-enrollment`, { open: true })).status).toBe(404);
    expect((await request(app).put(`/api/classes/${cls.id}/self-enrollment`).send({ open: true })).status).toBe(401);
  });
});

describe('public join page', () => {
  it('shows the class and instructor, and whether enrollment is open', async () => {
    const token = await open();
    const res = await join(token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      class: { subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST' },
      instructor: me.user.name,
      open: true,
    });
    await me.put(`/api/classes/${cls.id}/self-enrollment`, { open: false });
    expect((await join(token)).body.data.open).toBe(false);
    expect((await join('not-a-real-link-token-123')).status).toBe(404);
  });

  it('enrolls a new student without signing in, and it appears in the class and the activity feed', async () => {
    const token = await open();
    const res = await enroll(token, form());
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ class: { subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A' }, student: { studentNumber: '2025-00777', fullName: 'Rizal, José' } });

    const roster = (await me.get(`/api/students?classId=${cls.id}&scope=class`)).body.data;
    expect(roster.map((s) => s.studentNumber)).toContain('2025-00777');
    const activity = (await me.get(`/api/dashboard/activity?classId=${cls.id}`)).body.data;
    expect(activity[0].message).toBe('Rizal, José enrolled using the QR code');
  });

  it('refuses the same student number twice in a class', async () => {
    const token = await open();
    await enroll(token, form());
    const again = await enroll(token, form());
    expect(again.status).toBe(422);
    expect(again.body.error.details[0]).toMatchObject({ field: 'studentNumber', message: 'Student number 2025-00777 is already enrolled in this class.' });
    expect(await Enrollment.countDocuments({ class: cls.id })).toBe(1);
    expect(await Student.countDocuments({ studentNumber: '2025-00777' })).toBe(1);
  });

  it('reuses a student the instructor already has, but only if the name matches', async () => {
    await me.post('/api/students', validStudent({ studentNumber: '2025-00777', lastName: 'Rizal', firstName: 'Jose' }));
    const token = await open();
    const impostor = await enroll(token, form({ lastName: 'Bonifacio', firstName: 'Andres' }));
    expect(impostor.status).toBe(422);
    expect(impostor.body.error.details[0].message).toMatch(/already registered under a different name/);

    const ok = await enroll(token, form({ firstName: 'JOSE' })); // accents and capitals don't matter
    expect(ok.status).toBe(201);
    expect(await Student.countDocuments({ studentNumber: '2025-00777' })).toBe(1); // no duplicate record
  });

  it('refuses when closed, for archived classes, for students who were dropped, and invalid input', async () => {
    const token = await open();
    await me.put(`/api/classes/${cls.id}/self-enrollment`, { open: false });
    const closed = await enroll(token, form());
    expect(closed.status).toBe(409);
    expect(closed.body.error.message).toBe('Enrollment for this class is closed. Ask your instructor.');

    await me.put(`/api/classes/${cls.id}/self-enrollment`, { open: true });
    const created = await enroll(token, form());
    const studentId = (await Student.findOne({ studentNumber: '2025-00777' }))._id.toString();
    expect(created.status).toBe(201);
    await me.put(`/api/classes/${cls.id}/enrollments/${studentId}`, { status: 'DROPPED', reason: 'Officially dropped' });
    const dropped = await enroll(token, form());
    expect(dropped.status).toBe(409);
    expect(dropped.body.error.message).toMatch(/dropped from this class/);

    const bad = await enroll(token, form({ studentNumber: '!', yearLevel: 9 }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d) => d.field).sort()).toEqual(['studentNumber', 'yearLevel']);

    await me.del(`/api/classes/${cls.id}`); // archive
    expect((await join(token)).body.data.open).toBe(false);
  });

  it('asks the student to confirm when course, year level, or section differs from the class', async () => {
    const token = await open(); // class section BSIT-1A → BSIT, 1, A
    const wrong = await enroll(token, form({ course: 'BSCS', yearLevel: 2, section: 'B' }));
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('CLASS_MISMATCH');
    expect(wrong.body.error.message).toBe('This class is for BSIT 1-A, but you entered BSCS 2-B.');
    expect(wrong.body.error.details).toMatchObject({ expected: { course: 'BSIT', yearLevel: 1, section: 'A' }, fields: ['course', 'yearLevel', 'section'] });
    expect(await Enrollment.countDocuments({ class: cls.id })).toBe(0);

    const confirmed = await enroll(token, form({ course: 'BSCS', yearLevel: 2, section: 'B', confirmMismatch: true }));
    expect(confirmed.status).toBe(201);
    const activity = (await me.get(`/api/dashboard/activity?classId=${cls.id}`)).body.data;
    expect(activity[0].message).toBe("Rizal, José enrolled using the QR code (entered BSCS 2-B, not this class's section)");
  });

  it('accepts the usual ways of typing a matching section, and skips the check for unusual class names', async () => {
    const token = await open();
    expect((await enroll(token, form({ course: 'bsit', section: '1-a' }))).status).toBe(201);
    expect((await enroll(token, form({ studentNumber: '2025-00778', section: 'BSIT-1A' }))).status).toBe(201);

    const odd = (await me.post('/api/classes', validClass({ subjectCode: 'GE 1', section: 'Evening Block' }))).body.data;
    const oddToken = (await me.put(`/api/classes/${odd.id}/self-enrollment`, { open: true })).body.data.selfEnrollment.token;
    expect((await enroll(oddToken, form({ course: 'BSCS', yearLevel: 4, section: 'Z' }))).status).toBe(201);
  });

  it('lets a whole class enroll from one IP (campus NAT): 40 in a row succeed', async () => {
    const token = await open();
    const statuses = [];
    for (let i = 0; i < 40; i += 1) statuses.push((await enroll(token, form({ studentNumber: `2025-1${String(i).padStart(4, '0')}` }))).status);
    expect(statuses.every((s) => s === 201)).toBe(true);
  });

  it('limits each class link separately: exhausting one link does not block another', async () => {
    const tokenA = await open();
    const other = (await me.post('/api/classes', validClass({ subjectCode: 'IT 102', section: 'BSIT-1A' }))).body.data;
    const tokenB = (await me.put(`/api/classes/${other.id}/self-enrollment`, { open: true })).body.data.selfEnrollment.token;

    expect((await enroll(tokenA, form())).status).toBe(201);
    // Push link A's counter (this IP + token A) to the limit without sending 150 requests.
    const counters = await RateLimitHit.find({ _id: /^self-enroll:/ }).lean();
    expect(counters).toHaveLength(1);
    expect(counters[0]._id.endsWith(`|${tokenA}`)).toBe(true);
    await RateLimitHit.updateOne({ _id: counters[0]._id }, { $set: { hits: env.selfEnrollIpLimit } });

    const blocked = await enroll(tokenA, form({ studentNumber: '2025-00778' }));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/Too many enrollment attempts for this class/);
    expect((await enroll(tokenB, form({ studentNumber: '2025-00779' }))).status).toBe(201);
  });
});
