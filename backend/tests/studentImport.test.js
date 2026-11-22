import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Student } from '../src/models/Student.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
beforeEach(async () => {
  me = await instructorSession(app);
});

const upload = (csv, query = '', filename = 'students.csv') =>
  request(app).post(`/api/students/import${query}`).set(me.headers).attach('file', Buffer.from(csv, 'utf8'), filename);

const HEADER = 'Student Number,First Name,Middle Name,Last Name,Email,Course,Year Level,Section';

describe('CSV student import', () => {
  it('imports valid rows (BOM, flexible headers, accented names)', async () => {
    const csv = `﻿student_no,FIRSTNAME,mi,Surname,email,program,year,section\n2026-1,José,R,Rizal,,bsit,1,a\n2026-2,Niña,,Peña,nina@evsu.edu.ph,BSIT,1,A\n`;
    const res = await upload(csv);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ totalRows: 2, created: 2, skipped: 0 });
    const names = (await Student.find().sort({ studentNumber: 1 }).lean()).map((s) => `${s.firstName} ${s.lastName}`);
    expect(names).toEqual(['José Rizal', 'Niña Peña']);
  });

  it('dry run reports row-level errors with file line numbers and writes nothing', async () => {
    await me.post('/api/students', validStudent({ studentNumber: 'EXISTS-1' }));
    const csv = [
      HEADER,
      'OK-1,Ana,,Santos,,BSIT,1,A',
      'OK-1,Ben,,Reyes,,BSIT,1,A', // duplicate in file
      ',Carl,,Lim,bad-email,BSIT,9,A', // several errors
      'EXISTS-1,Dina,,Uy,,BSIT,1,A', // already in roster
    ].join('\n');
    const res = await upload(csv, '?dryRun=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: true, totalRows: 4, toCreate: 1, invalidRows: 3 });
    const byRow = Object.fromEntries(res.body.data.errors.map((e) => [e.row, e.errors.map((x) => x.field)]));
    expect(byRow[3]).toEqual(['studentNumber']);
    expect(byRow[4]).toEqual(expect.arrayContaining(['studentNumber', 'email', 'yearLevel']));
    expect(byRow[5]).toEqual(['studentNumber']);
    expect(await Student.countDocuments()).toBe(1);
  });

  it('is all-or-nothing unless skipInvalid is set', async () => {
    const csv = [HEADER, 'A-1,Ana,,Santos,,BSIT,1,A', 'A-2,,,Reyes,,BSIT,1,A'].join('\n');
    const strict = await upload(csv);
    expect(strict.status).toBe(422);
    expect(await Student.countDocuments()).toBe(0);

    const lenient = await upload(csv, '?skipInvalid=true');
    expect(lenient.status).toBe(201);
    expect(lenient.body.data).toMatchObject({ created: 1, skipped: 1 });
  });

  it('enrolls new and existing students into a class; flags name mismatches', async () => {
    const cls = (await me.post('/api/classes', validClass())).body.data;
    await me.post('/api/students', validStudent({ studentNumber: 'OLD-1', lastName: 'Garcia' }));
    const csv = [HEADER, 'NEW-1,Ana,,Santos,,BSIT,1,A', 'OLD-1,Luis,,Garcya,,BSIT,1,A'].join('\n');
    const res = await upload(csv, `?classId=${cls.id}`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 1, enrolledExisting: 1 });
    expect(res.body.data.warnings).toHaveLength(1);
    expect(await Enrollment.countDocuments({ class: cls.id, status: 'ENROLLED' })).toBe(2);
    const old = await Student.findOne({ studentNumber: 'OLD-1' });
    expect(old.lastName).toBe('Garcia'); // existing record left unchanged
  });

  it('rejects files with missing columns, no rows, or the wrong type', async () => {
    const missing = await upload('Student Number,First Name\n1,Ana\n');
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((d) => d.field)).toEqual(['lastName', 'course', 'yearLevel', 'section']);

    expect((await upload(`${HEADER}\n`)).status).toBe(400);
    expect((await upload('not,a,csv', '', 'students.xlsx')).status).toBe(400);
    expect((await request(app).post('/api/students/import').set(me.headers)).status).toBe(400);
  });

  it('rejects files over 1 MB', async () => {
    const big = `${HEADER}\n${'x'.repeat(1024 * 1024 + 10)}`;
    expect((await upload(big)).status).toBe(413);
  });

  it('cannot import into another instructor’s class', async () => {
    const other = await instructorSession(app);
    const theirClass = (await other.post('/api/classes', validClass())).body.data;
    const res = await upload(`${HEADER}\nX-1,Ana,,Santos,,BSIT,1,A`, `?classId=${theirClass.id}`);
    expect(res.status).toBe(404);
    expect(await Student.countDocuments()).toBe(0);
  });
});
