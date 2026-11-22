import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Student } from '../src/models/Student.js';
import { validateStudentInput } from '../src/validators/student.rules.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let other;
beforeEach(async () => {
  me = await instructorSession(app);
  other = await instructorSession(app);
});

describe('validateStudentInput (shared by API and CSV import)', () => {
  it('normalizes values', () => {
    const { value, errors } = validateStudentInput({
      studentNumber: ' 2026-00123 ', firstName: '  María  José ', lastName: 'Dela  Cruz', middleName: '',
      email: 'JUAN@EVSU.EDU.PH', course: 'bsit', yearLevel: '2', section: 'b',
    });
    expect(errors).toEqual([]);
    expect(value).toMatchObject({
      studentNumber: '2026-00123', firstName: 'María José', lastName: 'Dela Cruz', middleName: null,
      email: 'juan@evsu.edu.ph', course: 'BSIT', yearLevel: 2, section: 'B', enrollmentStatus: 'ENROLLED',
    });
  });

  it('accepts names with ñ, apostrophes, and hyphens', () => {
    const { errors } = validateStudentInput(validStudent({ firstName: 'Niño', lastName: "O'Neil-Peña" }));
    expect(errors).toEqual([]);
  });

  it('reports every invalid field', () => {
    const { errors } = validateStudentInput({ studentNumber: '#1', firstName: 'J0hn', lastName: '', course: '', yearLevel: '7', section: '', email: 'nope', enrollmentStatus: 'GRADUATED' });
    expect(errors.map((e) => e.field).sort()).toEqual(['course', 'email', 'enrollmentStatus', 'firstName', 'lastName', 'section', 'studentNumber', 'yearLevel'].sort());
  });

  it('rejects object payloads (type confusion)', () => {
    const { errors } = validateStudentInput({ ...validStudent(), lastName: { $ne: '' } });
    expect(errors).toEqual([{ field: 'lastName', message: 'Last name has an invalid type' }]);
  });

  it('only checks provided fields on partial updates', () => {
    expect(validateStudentInput({ section: 'c' }, { partial: true })).toEqual({ value: { section: 'C' }, errors: [] });
  });
});

describe('student CRUD', () => {
  it('creates a student with a full name and audit entry', async () => {
    const res = await me.post('/api/students', validStudent({ studentNumber: '2026-00001' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ studentNumber: '2026-00001', fullName: 'Dela Cruz, Juan P.', enrollmentStatus: 'ENROLLED' });
    expect(await AuditLog.countDocuments({ action: 'STUDENT_CREATE' })).toBe(1);
  });

  it('returns field errors with 422', async () => {
    const res = await me.post('/api/students', { firstName: 'Juan' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['studentNumber', 'lastName', 'course', 'yearLevel', 'section']));
  });

  it('prevents duplicate student numbers per instructor (case-insensitive), but allows them across instructors', async () => {
    await me.post('/api/students', validStudent({ studentNumber: '2026-ABC' }));
    const dup = await me.post('/api/students', validStudent({ studentNumber: '2026-abc' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/2026-ABC already exists/);
    expect((await other.post('/api/students', validStudent({ studentNumber: '2026-ABC' }))).status).toBe(201);
  });

  it('creates and enrolls in one step when classId is given', async () => {
    const cls = (await me.post('/api/classes', validClass())).body.data;
    const res = await me.post(`/api/students?classId=${cls.id}`, validStudent());
    expect(res.status).toBe(201);
    const roster = await me.get(`/api/classes/${cls.id}/enrollments`);
    expect(roster.body.data).toHaveLength(1);
    expect(roster.body.data[0]).toMatchObject({ studentId: res.body.data.id, status: 'ENROLLED' });
  });

  it('does not create the student if enrolling fails (atomic)', async () => {
    const cls = (await other.post('/api/classes', validClass())).body.data; // someone else's class
    const res = await me.post(`/api/students?classId=${cls.id}`, validStudent({ studentNumber: 'ATOMIC-1' }));
    expect(res.status).toBe(404);
    expect(await Student.countDocuments({ studentNumber: 'ATOMIC-1' })).toBe(0);
  });

  it('updates a student, preserving their id, and audits old/new values', async () => {
    const { id } = (await me.post('/api/students', validStudent({ studentNumber: 'UPD-1' }))).body.data;
    const res = await me.put(`/api/students/${id}`, { section: 'b', studentNumber: 'UPD-2' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, section: 'B', studentNumber: 'UPD-2' });
    const entry = await AuditLog.findOne({ action: 'STUDENT_UPDATE' }).lean();
    expect(entry.previousValue).toMatchObject({ section: 'A', studentNumber: 'UPD-1' });
    expect(entry.newValue).toMatchObject({ section: 'B', studentNumber: 'UPD-2' });
  });

  it('rejects renumbering onto an existing student number', async () => {
    await me.post('/api/students', validStudent({ studentNumber: 'TAKEN-1' }));
    const { id } = (await me.post('/api/students', validStudent())).body.data;
    expect((await me.put(`/api/students/${id}`, { studentNumber: 'taken-1' })).status).toBe(409);
  });

  it('archives (soft delete), hides from the default list, blocks edits, and restores', async () => {
    const { id } = (await me.post('/api/students', validStudent())).body.data;
    const archived = await me.del(`/api/students/${id}`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedAt).not.toBeNull();
    expect(await Student.countDocuments({ _id: id })).toBe(1); // still stored

    expect((await me.get('/api/students')).body.data).toHaveLength(0);
    expect((await me.get('/api/students?archived=true')).body.data).toHaveLength(1);
    expect((await me.put(`/api/students/${id}`, { section: 'Z' })).status).toBe(409);

    const restored = await me.post(`/api/students/${id}/restore`);
    expect(restored.body.data.archivedAt).toBeNull();
    expect(await AuditLog.countDocuments({ action: { $in: ['STUDENT_ARCHIVE', 'STUDENT_RESTORE'] } })).toBe(2);
  });

  it('never exposes or modifies another instructor’s students', async () => {
    const { id } = (await me.post('/api/students', validStudent())).body.data;
    expect((await other.get(`/api/students/${id}`)).status).toBe(404);
    expect((await other.put(`/api/students/${id}`, { section: 'X' })).status).toBe(404);
    expect((await other.del(`/api/students/${id}`)).status).toBe(404);
    expect((await other.get('/api/students')).body.data).toHaveLength(0);
  });

  it('shows class enrollments on the detail view', async () => {
    const cls = (await me.post('/api/classes', validClass())).body.data;
    const { id } = (await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data;
    const res = await me.get(`/api/students/${id}`);
    expect(res.body.data.enrollments).toEqual([
      expect.objectContaining({ classId: cls.id, subjectCode: 'IT 101', status: 'ENROLLED' }),
    ]);
  });
});

describe('student list: search, filter, sort, paginate', () => {
  beforeEach(async () => {
    const rows = [
      { studentNumber: 'S-001', firstName: 'Ana', lastName: 'Bautista', course: 'BSIT', yearLevel: 1, section: 'A' },
      { studentNumber: 'S-002', firstName: 'Carlo', lastName: 'aquino', course: 'BSIT', yearLevel: 2, section: 'B' },
      { studentNumber: 'S-003', firstName: 'Bea', lastName: 'Cruz', course: 'BSED', yearLevel: 1, section: 'A', enrollmentStatus: 'INACTIVE' },
      { studentNumber: 'S-004', firstName: 'Dan', lastName: 'Dela Cruz', course: 'BSED', yearLevel: 3, section: 'C' },
    ];
    for (const row of rows) await me.post('/api/students', { ...validStudent(), middleName: null, ...row });
  });

  it('sorts by last name case-insensitively by default', async () => {
    const res = await me.get('/api/students');
    expect(res.body.data.map((s) => s.lastName)).toEqual(['aquino', 'Bautista', 'Cruz', 'Dela Cruz']);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
  });

  it('searches by number, first or last name, and multi-word queries', async () => {
    const names = async (q) => (await me.get(`/api/students?search=${encodeURIComponent(q)}`)).body.data.map((s) => s.studentNumber);
    expect(await names('s-003')).toEqual(['S-003']);
    expect(await names('cruz')).toEqual(['S-003', 'S-004']);
    expect(await names('Cruz, Dan')).toEqual(['S-004']);
    expect(await names('.*')).toEqual([]); // regex metacharacters are literal
  });

  it('ignores accents in both directions and stays current after edits', async () => {
    const { id } = (await me.post('/api/students', { ...validStudent(), studentNumber: 'S-ACC', firstName: 'María', lastName: 'Peña' })).body.data;
    const find = async (q) => (await me.get(`/api/students?search=${encodeURIComponent(q)}`)).body.data.map((s) => s.studentNumber);
    expect(await find('maria pena')).toEqual(['S-ACC']);
    expect(await find('PEÑA')).toEqual(['S-ACC']);
    await me.put(`/api/students/${id}`, { lastName: 'Niño' });
    expect(await find('nino')).toEqual(['S-ACC']);
    expect(await find('pena')).toEqual([]);
  });

  it('never returns the internal search key', async () => {
    const res = await me.get('/api/students');
    expect(JSON.stringify(res.body)).not.toContain('searchKey');
  });

  it('filters by course, year level, section, and status', async () => {
    const numbers = async (qs) => (await me.get(`/api/students?${qs}`)).body.data.map((s) => s.studentNumber);
    expect(await numbers('course=bsed')).toEqual(['S-003', 'S-004']);
    expect(await numbers('yearLevel=1')).toEqual(['S-001', 'S-003']);
    expect(await numbers('section=a&course=BSIT')).toEqual(['S-001']);
    expect(await numbers('status=INACTIVE')).toEqual(['S-003']);
  });

  it('sorts by whitelisted columns in either direction', async () => {
    const res = await me.get('/api/students?sort=yearLevel&order=desc');
    expect(res.body.data.map((s) => s.yearLevel)).toEqual([3, 2, 1, 1]);
    expect((await me.get('/api/students?sort=passwordHash')).status).toBe(422);
  });

  it('paginates', async () => {
    const page2 = await me.get('/api/students?limit=3&page=2');
    expect(page2.body.data.map((s) => s.studentNumber)).toEqual(['S-004']);
    expect(page2.body.meta).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect((await me.get('/api/students?limit=1000')).status).toBe(422);
  });

  it('returns filter facets', async () => {
    const res = await me.get('/api/students/facets');
    expect(res.body.data).toEqual({ courses: ['BSED', 'BSIT'], sections: ['A', 'B', 'C'], yearLevels: [1, 2, 3] });
  });

  it('exports matching students as CSV with formula-injection protection', async () => {
    await me.post('/api/students', { ...validStudent(), studentNumber: 'S-999', lastName: 'Evil', firstName: 'Mallory', course: '=HYPERLINK("x")' });
    const res = await me.get('/api/students/export?search=evil');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="evsu-students-\d{8}\.csv"/);
    const lines = res.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('Student Number,Last Name,First Name,Middle Name,Email,Course,Year Level,Section,Status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""X"")"`);
  });
});

describe('authorization', () => {
  it('requires an instructor', async () => {
    expect((await request(app).get('/api/students')).status).toBe(401);
  });
});
