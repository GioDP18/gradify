import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
let students;
beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
  students = [];
  for (let i = 0; i < 3; i += 1) students.push((await me.post('/api/students', validStudent())).body.data);
});

const ids = (list) => list.map((s) => s.id);

describe('class enrollments', () => {
  it('bulk-enrolls students and is idempotent', async () => {
    const first = await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: ids(students.slice(0, 2)) });
    expect(first.body.data).toEqual({ enrolled: 2, reinstated: 0, alreadyEnrolled: 0 });
    const second = await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: ids(students) });
    expect(second.body.data).toEqual({ enrolled: 1, reinstated: 0, alreadyEnrolled: 2 });
    expect((await me.get(`/api/classes/${cls.id}/enrollments`)).body.data).toHaveLength(3);
  });

  it('lists the class roster through the student list with enrollment status', async () => {
    await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: ids(students.slice(0, 2)) });
    const res = await me.get(`/api/students?classId=${cls.id}`);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].enrollment.status).toBe('ENROLLED');
  });

  it('drops (→ DRP) with a reason, filters by status, and reinstates', async () => {
    const [a, b] = students;
    await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [a.id, b.id] });
    const drop = await me.put(`/api/classes/${cls.id}/enrollments/${a.id}`, { status: 'DROPPED', reason: 'Officially dropped before midterm' });
    expect(drop.body.data).toMatchObject({ status: 'DROPPED', dropReason: 'Officially dropped before midterm' });
    expect(drop.body.data.droppedAt).not.toBeNull();

    const dropped = await me.get(`/api/students?classId=${cls.id}&enrollment=DROPPED`);
    expect(dropped.body.data.map((s) => s.id)).toEqual([a.id]);

    const csv = await me.get(`/api/students/export?classId=${cls.id}`);
    expect(csv.text).toContain('Class Enrollment');
    expect(csv.text).toMatch(/,DRP\r?\n/);

    const reinstated = await me.put(`/api/classes/${cls.id}/enrollments/${a.id}`, { status: 'ENROLLED' });
    expect(reinstated.body.data).toMatchObject({ status: 'ENROLLED', droppedAt: null, dropReason: null });
    expect(await AuditLog.countDocuments({ action: { $in: ['ENROLLMENT_DROP', 'ENROLLMENT_REINSTATE'] } })).toBe(2);
  });

  it('re-enrolling a dropped student reinstates them', async () => {
    const [a] = students;
    await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [a.id] });
    await me.put(`/api/classes/${cls.id}/enrollments/${a.id}`, { status: 'DROPPED' });
    const res = await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [a.id] });
    expect(res.body.data).toEqual({ enrolled: 0, reinstated: 1, alreadyEnrolled: 0 });
  });

  it('removes a mistaken enrollment only while the student has no academic records', async () => {
    const [a, b] = students;
    await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [a.id, b.id] });
    expect((await me.del(`/api/classes/${cls.id}/enrollments/${a.id}`)).status).toBe(204);

    // Simulate an attendance record (the attendance module arrives in Phase 5).
    await mongoose.connection.db.collection('attendanceRecords').insertOne({
      class: new mongoose.Types.ObjectId(cls.id), student: new mongoose.Types.ObjectId(b.id), status: 'PRESENT',
    });
    const blocked = await me.del(`/api/classes/${cls.id}/enrollments/${b.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Drop the student instead/);
  });

  it('refuses archived students and archived classes', async () => {
    const [a, b] = students;
    await me.del(`/api/students/${a.id}`);
    expect((await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [a.id] })).status).toBe(409);

    await me.del(`/api/classes/${cls.id}`);
    expect((await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [b.id] })).status).toBe(409);
  });

  it('refuses students and classes owned by other instructors', async () => {
    const other = await instructorSession(app);
    const theirStudent = (await other.post('/api/students', validStudent())).body.data;
    const theirClass = (await other.post('/api/classes', validClass())).body.data;

    expect((await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [theirStudent.id] })).status).toBe(404);
    expect((await me.post(`/api/classes/${theirClass.id}/enrollments`, { studentIds: [students[0].id] })).status).toBe(404);
    expect((await me.get(`/api/classes/${theirClass.id}/enrollments`)).status).toBe(404);
  });

  it('validates the request body', async () => {
    expect((await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [] })).status).toBe(422);
    expect((await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: ['nope'] })).status).toBe(422);
    expect((await me.put(`/api/classes/${cls.id}/enrollments/${students[0].id}`, { status: 'GONE' })).status).toBe(422);
  });
});
