import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { AttendanceRecord } from '../src/models/AttendanceRecord.js';
import { AttendanceSession } from '../src/models/AttendanceSession.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { attendancePercentage } from '../src/services/grading/grading.calculator.js';
import { onSourceChanged } from '../src/services/grading/grading.events.js';
import { todayInTimeZone } from '../src/utils/dates.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
let students; // [a, b, c] enrolled
beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
  students = [];
  for (let i = 0; i < 3; i += 1) students.push((await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data);
});

const newSession = (overrides = {}) =>
  me.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-01', ...overrides });

describe('attendancePercentage (official formula D1)', () => {
  it('counts EXCUSED as present and returns null with no sessions', () => {
    expect(attendancePercentage({ present: 7, excused: 1, absent: 2, total: 10 })).toBe(80);
    expect(attendancePercentage({ present: 1, excused: 0, absent: 2, total: 3 })).toBeCloseTo(33.3333333, 6);
    expect(attendancePercentage({ total: 0 })).toBeNull();
  });
});

describe('creating attendance sessions', () => {
  it('generates PRESENT records for every currently enrolled student, on the server', async () => {
    const res = await newSession({ description: 'Lecture 1' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ sessionDate: '2026-09-01', period: 'MIDTERM', description: 'Lecture 1', counts: { present: 3, absent: 0, excused: 0, total: 3 }, attendanceRate: 100 });
    const records = await AttendanceRecord.find({ session: res.body.data.id }).lean();
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.status === 'PRESENT' && r.period === 'MIDTERM' && r.class.toString() === cls.id)).toBe(true);
  });

  it('ignores any status the client tries to send for new sessions', async () => {
    const res = await newSession({ records: [{ studentId: students[0].id, status: 'ABSENT' }], status: 'ABSENT' });
    expect(res.body.data.counts.present).toBe(3);
  });

  it('excludes dropped, archived, and non-enrolled (inactive) students', async () => {
    const [a, b, c] = students;
    await me.put(`/api/classes/${cls.id}/enrollments/${a.id}`, { status: 'DROPPED' });
    await me.del(`/api/students/${b.id}`);
    await me.put(`/api/students/${c.id}`, { enrollmentStatus: 'INACTIVE' });
    const d = (await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data;
    const res = await newSession();
    const records = await AttendanceRecord.find({ session: res.body.data.id }).lean();
    expect(records.map((r) => r.student.toString())).toEqual([d.id]);
  });

  it('does not add students enrolled later to earlier sessions', async () => {
    const first = (await newSession()).body.data;
    const late = (await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data;
    const second = (await newSession({ sessionDate: '2026-09-02' })).body.data;

    expect(await AttendanceRecord.countDocuments({ session: first.id })).toBe(3);
    expect(await AttendanceRecord.exists({ session: first.id, student: late.id })).toBeNull();
    expect(await AttendanceRecord.countDocuments({ session: second.id })).toBe(4);
  });

  it('prevents duplicate sessions for the same class, date, and period — but allows the other period', async () => {
    await newSession();
    const dup = await newSession();
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/2026-09-01 \(Midterm\) already exists/);
    expect((await newSession({ period: 'FINALS' })).status).toBe(201);
  });

  it('rejects future dates, invalid dates, and invalid periods', async () => {
    const tomorrow = new Date(`${todayInTimeZone('Asia/Manila')}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const future = await newSession({ sessionDate: tomorrow.toISOString().slice(0, 10) });
    expect(future.status).toBe(422);
    expect(future.body.error.details[0].message).toMatch(/future/);
    expect((await newSession({ sessionDate: '2026-02-30' })).status).toBe(422);
    expect((await newSession({ period: 'PRELIM' })).status).toBe(422);
  });

  it('refuses classes with no enrolled students and archived classes', async () => {
    const empty = (await me.post('/api/classes', validClass({ section: 'EMPTY' }))).body.data;
    const res = await me.post('/api/attendance/sessions', { classId: empty.id, period: 'MIDTERM', sessionDate: '2026-09-01' });
    expect(res.status).toBe(409);
    expect(await AttendanceSession.countDocuments({ class: empty.id })).toBe(0);

    await me.del(`/api/classes/${cls.id}`);
    expect((await newSession()).status).toBe(409);
  });

  it('cannot create sessions in another instructor’s class', async () => {
    const other = await instructorSession(app);
    const res = await other.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-01' });
    expect(res.status).toBe(404);
  });

  it('audits creation', async () => {
    await newSession();
    const entry = await AuditLog.findOne({ action: 'ATTENDANCE_SESSION_CREATE' }).lean();
    expect(entry.newValue).toMatchObject({ sessionDate: '2026-09-01', period: 'MIDTERM', students: 3 });
  });
});

describe('updating attendance records', () => {
  let session;
  beforeEach(async () => {
    session = (await newSession()).body.data;
  });

  const save = (records, revision = 0) => me.put(`/api/attendance/sessions/${session.id}/records`, { revision, records });

  it('marks students ABSENT/EXCUSED and back to PRESENT, with counts and audit', async () => {
    const [a, b] = students;
    const res = await save([{ studentId: a.id, status: 'ABSENT' }, { studentId: b.id, status: 'EXCUSED' }]);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ changed: 2, revision: 1 });
    expect(res.body.data.session.counts).toEqual({ present: 1, absent: 1, excused: 1, total: 3 });
    expect(res.body.data.session.attendanceRate).toBeCloseTo(66.6667, 3);

    const restore = await save([{ studentId: a.id, status: 'PRESENT' }], 1);
    expect(restore.body.data.session.counts.present).toBe(2);

    const entry = await AuditLog.findOne({ action: 'ATTENDANCE_RECORDS_UPDATE' }).sort({ createdAt: 1 }).lean();
    expect(entry.previousValue).toEqual(expect.arrayContaining([{ student: a.id, status: 'PRESENT' }]));
    expect(entry.newValue).toEqual(expect.arrayContaining([{ student: a.id, status: 'ABSENT' }, { student: b.id, status: 'EXCUSED' }]));
  });

  it('rejects a stale revision (another tab saved first) without changing anything', async () => {
    const [a, b] = students;
    await save([{ studentId: a.id, status: 'ABSENT' }], 0);
    const stale = await save([{ studentId: b.id, status: 'ABSENT' }], 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');
    expect((await AttendanceRecord.findOne({ session: session.id, student: b.id })).status).toBe('PRESENT');
  });

  it('allows only one of two simultaneous saves with the same revision', async () => {
    const [a, b] = students;
    const results = await Promise.all([
      save([{ studentId: a.id, status: 'ABSENT' }], 0),
      save([{ studentId: b.id, status: 'EXCUSED' }], 0),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await AttendanceSession.findById(session.id)).revision).toBe(1);
  });

  it('rejects invalid statuses, unknown students, and duplicates — atomically', async () => {
    const [a] = students;
    expect((await save([{ studentId: a.id, status: 'LATE' }])).status).toBe(422);
    const outsider = (await me.post('/api/students', validStudent())).body.data;
    const res = await save([{ studentId: a.id, status: 'ABSENT' }, { studentId: outsider.id, status: 'ABSENT' }]);
    expect(res.status).toBe(422);
    expect((await AttendanceRecord.findOne({ session: session.id, student: a.id })).status).toBe('PRESENT');
    expect((await AttendanceSession.findById(session.id)).revision).toBe(0); // rolled back
    expect((await save([{ studentId: a.id, status: 'ABSENT' }, { studentId: a.id, status: 'EXCUSED' }])).status).toBe(422);
  });

  it('notifies the grading engine about exactly the changed students and period', async () => {
    const changes = [];
    const off = onSourceChanged((change) => changes.push(change));
    const [a, b] = students;
    await save([{ studentId: a.id, status: 'ABSENT' }, { studentId: b.id, status: 'PRESENT' }]);
    off();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ periods: ['MIDTERM'], reason: 'ATTENDANCE_RECORDS_UPDATE' });
    expect(changes[0].studentIds.map(String)).toEqual([a.id]);
  });

  it('lists records with student details, sorted by name', async () => {
    const res = await me.get(`/api/attendance/sessions/${session.id}/records`);
    expect(res.body.data.records).toHaveLength(3);
    expect(res.body.data.records[0]).toMatchObject({ status: 'PRESENT', enrollmentStatus: 'ENROLLED', archived: false });
    expect(res.body.data.session.revision).toBe(0);
  });
});

describe('editing and deleting sessions', () => {
  it('edits date and description but locks the grading period once records exist', async () => {
    const s = (await newSession()).body.data;
    const res = await me.put(`/api/attendance/sessions/${s.id}`, { sessionDate: '2026-09-03', description: 'Moved' });
    expect(res.body.data).toMatchObject({ sessionDate: '2026-09-03', description: 'Moved' });
    const locked = await me.put(`/api/attendance/sessions/${s.id}`, { period: 'FINALS' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toMatch(/period cannot be changed/);
  });

  it('refuses to move a session onto an existing date', async () => {
    await newSession({ sessionDate: '2026-09-01' });
    const s2 = (await newSession({ sessionDate: '2026-09-02' })).body.data;
    expect((await me.put(`/api/attendance/sessions/${s2.id}`, { sessionDate: '2026-09-01' })).status).toBe(409);
  });

  it('deletes a session with its records and keeps a snapshot in the audit log', async () => {
    const s = (await newSession()).body.data;
    await me.put(`/api/attendance/sessions/${s.id}/records`, { revision: 0, records: [{ studentId: students[0].id, status: 'ABSENT' }] });
    expect((await me.del(`/api/attendance/sessions/${s.id}`)).status).toBe(204);
    expect(await AttendanceRecord.countDocuments({ session: s.id })).toBe(0);
    const entry = await AuditLog.findOne({ action: 'ATTENDANCE_SESSION_DELETE' }).lean();
    expect(entry.previousValue.records).toHaveLength(3);
    expect(entry.previousValue.records).toEqual(expect.arrayContaining([{ student: students[0].id, status: 'ABSENT' }]));
  });
});

describe('listing and summaries', () => {
  beforeEach(async () => {
    const [a, b] = students;
    const s1 = (await newSession({ sessionDate: '2026-09-01' })).body.data;
    const s2 = (await newSession({ sessionDate: '2026-09-08' })).body.data;
    await newSession({ sessionDate: '2026-11-03', period: 'FINALS' });
    await me.put(`/api/attendance/sessions/${s1.id}/records`, { revision: 0, records: [{ studentId: a.id, status: 'ABSENT' }] });
    await me.put(`/api/attendance/sessions/${s2.id}/records`, { revision: 0, records: [{ studentId: a.id, status: 'EXCUSED' }, { studentId: b.id, status: 'ABSENT' }] });
  });

  it('lists sessions newest first with counts, separated by period and filterable by date', async () => {
    const midterm = await me.get(`/api/attendance?classId=${cls.id}&period=MIDTERM`);
    expect(midterm.body.data.map((s) => s.sessionDate)).toEqual(['2026-09-08', '2026-09-01']);
    expect(midterm.body.data[0].counts).toEqual({ present: 1, absent: 1, excused: 1, total: 3 });

    const finals = await me.get(`/api/attendance?classId=${cls.id}&period=FINALS`);
    expect(finals.body.data).toHaveLength(1);

    const ranged = await me.get(`/api/attendance?classId=${cls.id}&from=2026-09-05&to=2026-09-30`);
    expect(ranged.body.data.map((s) => s.sessionDate)).toEqual(['2026-09-08']);
  });

  it('summarizes per student and per period using the official formula', async () => {
    const res = await me.get(`/api/attendance/summary?classId=${cls.id}`);
    const a = res.body.data.students.find((s) => s.studentId === students[0].id && s.period === 'MIDTERM');
    expect(a).toMatchObject({ present: 0, absent: 1, excused: 1, total: 2, attendanceRate: 50 });
    const finalsA = res.body.data.students.find((s) => s.studentId === students[0].id && s.period === 'FINALS');
    expect(finalsA).toMatchObject({ present: 1, total: 1, attendanceRate: 100 });

    const midterm = res.body.data.periods.find((p) => p.period === 'MIDTERM');
    expect(midterm).toMatchObject({ sessions: 2, present: 3, absent: 2, excused: 1, total: 6 });
    expect(midterm.attendanceRate).toBeCloseTo(66.6667, 3);
  });

  it('summarizes one student across classes', async () => {
    const res = await me.get(`/api/attendance/summary?studentId=${students[1].id}`);
    expect(res.body.data.students.map((s) => s.period)).toEqual(['MIDTERM', 'FINALS']);
    expect((await me.get('/api/attendance/summary')).status).toBe(422);
  });

  it('never shows another instructor’s attendance', async () => {
    const other = await instructorSession(app);
    expect((await other.get(`/api/attendance?classId=${cls.id}`)).status).toBe(404);
    expect((await other.get(`/api/attendance/summary?studentId=${students[0].id}`)).status).toBe(404);
    const session = await AttendanceSession.findOne();
    expect((await other.get(`/api/attendance/sessions/${session._id}/records`)).status).toBe(404);
    expect((await other.put(`/api/attendance/sessions/${session._id}/records`, { revision: 1, records: [{ studentId: students[0].id, status: 'PRESENT' }] })).status).toBe(404);
  });
});

describe('enrollment removal guard (Phase 4) now sees attendance', () => {
  afterEach(() => {});
  it('blocks removing an enrollment once attendance exists', async () => {
    await newSession();
    const res = await me.del(`/api/classes/${cls.id}/enrollments/${students[0].id}`);
    expect(res.status).toBe(409);
  });
});
