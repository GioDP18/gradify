import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { ASSESSMENT_TYPES } from '../src/models/assessments.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { onSourceChanged } from '../src/services/grading/grading.events.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

const TYPES = [
  { path: 'quizzes', type: ASSESSMENT_TYPES.quizzes, collections: ['writtenQuizzes', 'quizScores'] },
  { path: 'activities', type: ASSESSMENT_TYPES.activities, collections: ['performanceActivities', 'activityScores'] },
  { path: 'examinations', type: ASSESSMENT_TYPES.examinations, collections: ['examinations', 'examinationScores'] },
];

describe.each(TYPES)('/api/$path', ({ path, type, collections }) => {
  let me;
  let cls;
  let students;
  const base = `/api/${path}`;

  beforeEach(async () => {
    me = await instructorSession(app);
    cls = (await me.post('/api/classes', validClass())).body.data;
    students = [];
    for (let i = 0; i < 3; i += 1) students.push((await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data);
  });

  const create = (overrides = {}) =>
    me.post(base, { classId: cls.id, title: 'Item 1', period: 'MIDTERM', date: '2026-09-10', maxScore: 20, ...overrides });
  const save = (id, scores, revision = 0) => me.put(`${base}/${id}/scores`, { revision, scores });

  describe('CRUD', () => {
    it(`stores items and scores in their own collections (${collections.join(', ')})`, async () => {
      const item = (await create()).body.data;
      await save(item.id, [{ studentId: students[0].id, score: 10 }]);
      const db = mongoose.connection.db;
      expect(await db.collection(collections[0]).countDocuments({ _id: new mongoose.Types.ObjectId(item.id) })).toBe(1);
      expect(await db.collection(collections[1]).countDocuments({ [type.refField]: new mongoose.Types.ObjectId(item.id) })).toBe(1);
    });

    it('creates (published by default), lists by period, and gets with statistics', async () => {
      const res = await create({ description: 'Chapter 1', instructions: 'Closed notes' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ title: 'Item 1', period: 'MIDTERM', date: '2026-09-10', maxScore: 20, status: 'PUBLISHED', description: 'Chapter 1' });
      await create({ title: 'Finals item', period: 'FINALS' });

      const midterm = await me.get(`${base}?classId=${cls.id}&period=MIDTERM`);
      expect(midterm.body.data.map((i) => i.title)).toEqual(['Item 1']);
      expect(midterm.body.data[0].stats).toMatchObject({ totalStudents: 3, scoredCount: 0, missingCount: 3 });

      const one = await me.get(`${base}/${res.body.data.id}`);
      expect(one.body.data.stats.distribution).toHaveLength(10);
    });

    it('validates fields: positive maximum, period, date, title', async () => {
      const res = await me.post(base, { classId: cls.id, title: '', period: 'PRELIM', date: '10/09/2026', maxScore: 0 });
      expect(res.status).toBe(422);
      expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['date', 'maxScore', 'period', 'title']);
      expect((await create({ maxScore: -5 })).status).toBe(422);
      expect((await create({ maxScore: '20' })).status).toBe(422);
      expect((await create({ maxScore: 12.345 })).status).toBe(422);
      expect((await create({ maxScore: 12.5 })).status).toBe(201);
    });

    it('edits details and audits previous/new values', async () => {
      const item = (await create()).body.data;
      const res = await me.put(`${base}/${item.id}`, { title: 'Renamed', maxScore: 25, status: 'DRAFT' });
      expect(res.body.data).toMatchObject({ title: 'Renamed', maxScore: 25, status: 'DRAFT' });
      const entry = await AuditLog.findOne({ action: `${type.auditPrefix}_UPDATE` }).lean();
      expect(entry.previousValue).toMatchObject({ title: 'Item 1', maxScore: 20, status: 'PUBLISHED' });
      expect(entry.newValue).toMatchObject({ title: 'Renamed', maxScore: 25, status: 'DRAFT' });
    });

    it('locks the grading period once scores exist', async () => {
      const item = (await create()).body.data;
      const moved = await me.put(`${base}/${item.id}`, { period: 'FINALS' }); // no scores yet
      expect(moved.status).toBe(200);
      // Edits bump the revision (they are serialized with score saves), so save with the current one.
      expect((await save(item.id, [{ studentId: students[0].id, score: 5 }], moved.body.data.revision)).status).toBe(200);
      const res = await me.put(`${base}/${item.id}`, { period: 'MIDTERM' });
      expect(res.status).toBe(409);
    });

    it('refuses to lower the maximum below an existing score', async () => {
      const item = (await create()).body.data;
      await save(item.id, [{ studentId: students[0].id, score: 18 }]);
      const res = await me.put(`${base}/${item.id}`, { maxScore: 15 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/existing score \(18\)/);
      expect((await me.put(`${base}/${item.id}`, { maxScore: 18 })).status).toBe(200);
    });

    it('soft-deletes: hidden and no longer editable, but scores are preserved', async () => {
      const item = (await create()).body.data;
      await save(item.id, [{ studentId: students[0].id, score: 12 }]);
      expect((await me.del(`${base}/${item.id}`)).status).toBe(204);
      expect((await me.get(`${base}?classId=${cls.id}`)).body.data).toHaveLength(0);
      expect((await me.get(`${base}/${item.id}`)).status).toBe(404);
      expect((await save(item.id, [{ studentId: students[0].id, score: 1 }], 1)).status).toBe(404);
      expect(await type.Score.countDocuments({ [type.refField]: item.id })).toBe(1);
      const entry = await AuditLog.findOne({ action: `${type.auditPrefix}_DELETE` }).lean();
      expect(entry.metadata.preservedScores).toBe(1);
    });

    it('is invisible to other instructors', async () => {
      const item = (await create()).body.data;
      const other = await instructorSession(app);
      expect((await other.get(`${base}/${item.id}`)).status).toBe(404);
      expect((await other.get(`${base}?classId=${cls.id}`)).status).toBe(404);
      expect((await other.put(`${base}/${item.id}/scores`, { revision: 0, scores: [{ studentId: students[0].id, score: 1 }] })).status).toBe(404);
      expect((await other.post(base, { classId: cls.id, title: 'X', period: 'MIDTERM', date: '2026-09-10', maxScore: 10 })).status).toBe(404);
    });
  });

  describe('score entry', () => {
    let item;
    beforeEach(async () => {
      item = (await create()).body.data;
    });

    it('lists every enrolled student, with missing scores as null (not zero)', async () => {
      const res = await me.get(`${base}/${item.id}/scores`);
      expect(res.body.data.rows).toHaveLength(3);
      expect(res.body.data.rows.every((r) => r.score === null && r.required)).toBe(true);
      expect(res.body.data.assessment.stats).toMatchObject({ totalStudents: 3, scoredCount: 0, missingCount: 3, highest: null });
    });

    it('saves decimal scores and zeros, clears scores with null, and computes statistics', async () => {
      const [a, b, c] = students;
      const res = await save(item.id, [{ studentId: a.id, score: 17.5 }, { studentId: b.id, score: 0 }, { studentId: c.id, score: 20 }]);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ changed: 3, revision: 1 });
      const byId = Object.fromEntries(res.body.data.rows.map((r) => [r.studentId, r]));
      expect(byId[a.id]).toMatchObject({ score: 17.5, itemPercent: 87.5 });
      expect(byId[b.id].score).toBe(0); // zero is a real score
      expect(res.body.data.assessment.stats).toMatchObject({ scoredCount: 3, missingCount: 0, highest: 20, lowest: 0 });
      expect(res.body.data.assessment.stats.average).toBeCloseTo(12.5, 10);

      const cleared = await save(item.id, [{ studentId: b.id, score: null }], 1);
      expect(cleared.body.data.rows.find((r) => r.studentId === b.id).score).toBeNull();
      expect(await type.Score.countDocuments({ [type.refField]: item.id, student: b.id })).toBe(0);
      expect(cleared.body.data.assessment.stats).toMatchObject({ scoredCount: 2, missingCount: 1 });
    });

    it('rejects negative, above-maximum, non-numeric, and over-precise scores — atomically', async () => {
      const [a, b] = students;
      const res = await save(item.id, [{ studentId: a.id, score: 21 }, { studentId: b.id, score: -1 }]);
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual([
        { field: a.id, message: 'Score cannot exceed the maximum of 20' },
        { field: b.id, message: 'Score cannot be negative' },
      ]);
      expect((await save(item.id, [{ studentId: a.id, score: '15' }])).status).toBe(422);
      expect((await save(item.id, [{ studentId: a.id, score: 15.555 }])).status).toBe(422);
      expect(await type.Score.countDocuments()).toBe(0);
    });

    it('prevents duplicate scores for the same student', async () => {
      const [a] = students;
      expect((await save(item.id, [{ studentId: a.id, score: 1 }, { studentId: a.id, score: 2 }])).status).toBe(422);
      await save(item.id, [{ studentId: a.id, score: 5 }]);
      await save(item.id, [{ studentId: a.id, score: 6 }], 1);
      const docs = await type.Score.find({ [type.refField]: item.id, student: a.id }).lean();
      expect(docs).toHaveLength(1);
      expect(docs[0].score).toBe(6);
    });

    it('rejects students who are not enrolled in the class', async () => {
      const outsider = (await me.post('/api/students', validStudent())).body.data;
      const res = await save(item.id, [{ studentId: outsider.id, score: 5 }]);
      expect(res.status).toBe(422);
      expect(res.body.error.details[0]).toEqual({ field: outsider.id, message: 'Student is not enrolled in this class' });
    });

    it('keeps scores of students dropped later visible on the sheet (not required)', async () => {
      const [a] = students;
      await save(item.id, [{ studentId: a.id, score: 9 }]);
      await me.put(`/api/classes/${cls.id}/enrollments/${a.id}`, { status: 'DROPPED' });
      const sheet = await me.get(`${base}/${item.id}/scores`);
      const row = sheet.body.data.rows.find((r) => r.studentId === a.id);
      expect(row).toMatchObject({ score: 9, required: false, enrollmentStatus: 'DROPPED' });
      expect(sheet.body.data.assessment.stats.totalStudents).toBe(2);
    });

    it('rejects stale saves and lets exactly one of two concurrent saves win', async () => {
      const [a, b] = students;
      await save(item.id, [{ studentId: a.id, score: 10 }], 0);
      const stale = await save(item.id, [{ studentId: b.id, score: 10 }], 0);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_REVISION');

      const results = await Promise.all([save(item.id, [{ studentId: b.id, score: 11 }], 1), save(item.id, [{ studentId: b.id, score: 12 }], 1)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const stored = (await type.Score.findOne({ [type.refField]: item.id, student: b.id })).score;
      expect([11, 12]).toContain(stored);
    });

    it('audits score changes with previous and new values', async () => {
      const [a] = students;
      await save(item.id, [{ studentId: a.id, score: 10 }]);
      await save(item.id, [{ studentId: a.id, score: 14 }], 1);
      const entries = await AuditLog.find({ action: `${type.auditPrefix}_SCORES_UPDATE` }).sort({ createdAt: 1 }).lean();
      expect(entries).toHaveLength(2);
      expect(entries[1].previousValue).toEqual([{ student: a.id, score: 10 }]);
      expect(entries[1].newValue).toEqual([{ student: a.id, score: 14 }]);
    });
  });

  describe('grade recalculation triggers', () => {
    it('notifies the grading engine on create, score change, edit, and delete — with the right scope', async () => {
      const changes = [];
      const off = onSourceChanged((change) => changes.push({ ...change, studentIds: change.studentIds.map(String) }));
      try {
        const item = (await create()).body.data;
        await save(item.id, [{ studentId: students[0].id, score: 5 }]);
        await save(item.id, [{ studentId: students[0].id, score: 5 }], 1); // unchanged → no notification
        await me.put(`${base}/${item.id}`, { title: 'Just a rename' }); // no grade impact → no notification
        await me.put(`${base}/${item.id}`, { maxScore: 30 });
        await me.del(`${base}/${item.id}`);
      } finally {
        off();
      }
      const all = students.map((s) => s.id).sort();
      expect(changes.map((c) => c.reason)).toEqual([
        `${type.auditPrefix}_CREATE`, `${type.auditPrefix}_SCORES_UPDATE`, `${type.auditPrefix}_UPDATE`, `${type.auditPrefix}_DELETE`,
      ]);
      expect(changes[0].studentIds.sort()).toEqual(all);
      expect(changes[1].studentIds).toEqual([students[0].id]);
      expect(changes.every((c) => c.periods.join() === 'MIDTERM')).toBe(true);
    });

    it('draft items do not trigger recalculation until published', async () => {
      const changes = [];
      const off = onSourceChanged((change) => changes.push(change));
      const item = (await create({ status: 'DRAFT' })).body.data;
      expect(changes).toHaveLength(0);
      await me.put(`${base}/${item.id}`, { status: 'PUBLISHED' });
      off();
      expect(changes).toHaveLength(1);
    });

    it('a period move notifies both periods', async () => {
      const changes = [];
      const item = (await create()).body.data;
      const off = onSourceChanged((change) => changes.push(change));
      await me.put(`${base}/${item.id}`, { period: 'FINALS' });
      off();
      expect(changes[0].periods.sort()).toEqual(['FINALS', 'MIDTERM']);
    });
  });
});

describe('Midterm and Finals separation across modules', () => {
  it('scores carry the period of their assessment and never mix', async () => {
    const me = await instructorSession(app);
    const cls = (await me.post('/api/classes', validClass())).body.data;
    const s = (await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data;
    const mid = (await me.post('/api/quizzes', { classId: cls.id, title: 'Q-M', period: 'MIDTERM', date: '2026-09-10', maxScore: 10 })).body.data;
    const fin = (await me.post('/api/quizzes', { classId: cls.id, title: 'Q-F', period: 'FINALS', date: '2026-11-10', maxScore: 10 })).body.data;
    await me.put(`/api/quizzes/${mid.id}/scores`, { revision: 0, scores: [{ studentId: s.id, score: 7 }] });
    await me.put(`/api/quizzes/${fin.id}/scores`, { revision: 0, scores: [{ studentId: s.id, score: 9 }] });
    const { QuizScore } = await import('../src/models/assessments.js');
    expect((await QuizScore.find({ period: 'MIDTERM' }).lean()).map((x) => x.score)).toEqual([7]);
    expect((await QuizScore.find({ period: 'FINALS' }).lean()).map((x) => x.score)).toEqual([9]);
  });
});
