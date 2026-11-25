/**
 * Regression tests for defects found in the Phase 10 independent security/integrity review.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { ComputedGrade } from '../src/models/ComputedGrade.js';
import { QuizScore } from '../src/models/assessments.js';
import { User } from '../src/models/User.js';
import { ensureCurrent } from '../src/services/grading/grading.service.js';
import { MAX_FAILED_LOGINS } from '../src/services/auth.service.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, adminSession, validStudent, validClass, createUser, DEFAULT_PASSWORD } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
let ana;
let ben;

async function item(kind, period, title) {
  return (await me.post(`/api/${kind}`, { classId: cls.id, title, period, date: '2026-09-10', maxScore: 100 })).body.data;
}
async function score(kind, it, entries) {
  const sheet = await me.get(`/api/${kind}/${it.id}/scores`);
  return me.put(`/api/${kind}/${it.id}/scores`, { revision: sheet.body.data.assessment.revision, scores: entries });
}
const grade = async (period, s) => (await me.get(`/api/grading/${period}/student/${s.id}?classId=${cls.id}`)).body.data.grade;

/** Every component has an item in both periods; Ben is missing the midterm exam (→ INC). */
async function fullSetup({ termEndDate } = {}) {
  if (termEndDate) await me.put(`/api/classes/${cls.id}`, { termEndDate });
  await me.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-08-01' });
  await me.post('/api/attendance/sessions', { classId: cls.id, period: 'FINALS', sessionDate: '2026-08-02' });
  const items = {};
  for (const period of ['MIDTERM', 'FINALS']) {
    for (const kind of ['quizzes', 'activities', 'examinations']) {
      const it = await item(kind, period, `${kind} ${period}`);
      items[`${kind}:${period}`] = it;
      const entries = [{ studentId: ana.id, score: 90 }];
      if (!(kind === 'examinations' && period === 'MIDTERM')) entries.push({ studentId: ben.id, score: 90 });
      await score(kind, it, entries);
    }
  }
  return items;
}

beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
  ana = (await me.post(`/api/students?classId=${cls.id}`, validStudent({ firstName: 'Ana' }))).body.data;
  ben = (await me.post(`/api/students?classId=${cls.id}`, validStudent({ firstName: 'Ben' }))).body.data;
});

describe('#1 one definition of who is graded', () => {
  it('archived and inactive students who are still enrolled stay on score sheets, can be scored, and are recalculated', async () => {
    await fullSetup();
    await me.del(`/api/students/${ana.id}`); // archive
    await me.put(`/api/students/${ben.id}`, { enrollmentStatus: 'INACTIVE' });

    const quiz = await item('quizzes', 'MIDTERM', 'Late quiz');
    // The new published quiz made both students' grades stale and they were recalculated (now INC).
    expect((await ComputedGrade.findOne({ student: ana.id, period: 'MIDTERM' }).lean())).toMatchObject({ calcStatus: 'CURRENT', completionStatus: 'INCOMPLETE' });

    const sheet = await me.get(`/api/quizzes/${quiz.id}/scores`);
    expect(sheet.body.data.rows.map((r) => [r.studentId, r.required])).toEqual(expect.arrayContaining([[ana.id, true], [ben.id, true]]));
    expect(sheet.body.data.rows.find((r) => r.studentId === ana.id).archived).toBe(true);

    const saved = await score('quizzes', quiz, [{ studentId: ana.id, score: 80 }]);
    expect(saved.status).toBe(200);
    expect((await grade('midterm', ana)).completionStatus).toBe('COMPLETE');
  });
});

describe('#2 lapsed INC survives drop → reinstate', () => {
  it('keeps 5.0 (INC lapsed) after the student is dropped and reinstated', async () => {
    await fullSetup({ termEndDate: '2024-01-15' });
    expect(await grade('overall', ben)).toMatchObject({ completionStatus: 'INC_LAPSED', grade: 5.0 });
    await me.put(`/api/classes/${cls.id}/enrollments/${ben.id}`, { status: 'DROPPED' });
    expect((await grade('overall', ben)).remarks).toBe('DRP');
    await me.put(`/api/classes/${cls.id}/enrollments/${ben.id}`, { status: 'ENROLLED' });
    expect(await grade('overall', ben)).toMatchObject({ completionStatus: 'INC_LAPSED', grade: 5.0, remarks: 'Failure (INC lapsed)' });
  });
});

describe('#3 / #9 login protection', () => {
  it('parallel wrong passwords still lock the account', async () => {
    const user = await createUser();
    // The lock needs MAX_FAILED_LOGINS failures, and one IP is limited to 10 per account, so the
    // attempts come from distinct client IPs (tests run with TRUST_PROXY=1).
    await Promise.all(Array.from({ length: MAX_FAILED_LOGINS + 5 }, (_, i) =>
      request(app).post('/api/auth/login').set('X-Forwarded-For', `203.0.113.${i + 1}`).send({ identifier: user.email, password: 'wrong-password' })));
    const fresh = await User.findById(user._id).select('+lockUntil');
    expect(fresh.lockUntil.getTime()).toBeGreaterThan(Date.now());
    const correct = await request(app).post('/api/auth/login').send({ identifier: user.email, password: DEFAULT_PASSWORD });
    expect(correct.status).toBe(423);
  });

  it('a locked account answers wrong passwords exactly like an unknown account', async () => {
    const user = await createUser();
    await User.updateOne({ _id: user._id }, { $set: { lockUntil: new Date(Date.now() + 60000) } });
    const locked = await request(app).post('/api/auth/login').send({ identifier: user.email, password: 'wrong-password' });
    const unknown = await request(app).post('/api/auth/login').send({ identifier: 'nobody@evsu.test', password: 'wrong-password' });
    expect(locked.status).toBe(401);
    expect(locked.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('#4 edits and score saves are serialized', () => {
  it('a period change racing a score save never leaves scores in the wrong period', async () => {
    const quiz = await item('quizzes', 'MIDTERM', 'Race quiz');
    const sheet = await me.get(`/api/quizzes/${quiz.id}/scores`);
    const [edit, save] = await Promise.all([
      me.put(`/api/quizzes/${quiz.id}`, { period: 'FINALS' }),
      me.put(`/api/quizzes/${quiz.id}/scores`, { revision: sheet.body.data.assessment.revision, scores: [{ studentId: ana.id, score: 10 }] }),
    ]);
    const statuses = [edit.status, save.status];
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    const stored = await QuizScore.find({ quiz: quiz.id }).lean();
    const current = (await me.get(`/api/quizzes/${quiz.id}`)).body.data;
    // Either the period moved (and no score exists) or the score exists (and the period did not move).
    if (stored.length) {
      expect(current.period).toBe('MIDTERM');
      expect(stored[0].period).toBe('MIDTERM');
    } else {
      expect(current.period).toBe('FINALS');
    }
  });

  it('editing details changes the revision, so a score page opened before the edit must reload', async () => {
    const quiz = await item('quizzes', 'MIDTERM', 'Quiz');
    const before = (await me.get(`/api/quizzes/${quiz.id}/scores`)).body.data.assessment.revision;
    await me.put(`/api/quizzes/${quiz.id}`, { maxScore: 10 });
    // A valid score, sent with the revision from before the edit, is refused as stale.
    const stale = await me.put(`/api/quizzes/${quiz.id}/scores`, { revision: before, scores: [{ studentId: ana.id, score: 5 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');
    // A score valid only under the old maximum is refused outright.
    const tooHigh = await me.put(`/api/quizzes/${quiz.id}/scores`, { revision: before + 1, scores: [{ studentId: ana.id, score: 50 }] });
    expect(tooHigh.status).toBe(422);
    expect(await QuizScore.countDocuments()).toBe(0);
  });
});

describe('#5 removed enrollments leave no computed grades behind', () => {
  it('cleans up orphaned computed grades on the next read', async () => {
    const extra = (await me.post(`/api/students?classId=${cls.id}`, validStudent())).body.data;
    await me.get(`/api/grading/midterm?classId=${cls.id}`);
    expect((await me.del(`/api/classes/${cls.id}/enrollments/${extra.id}`)).status).toBe(204);
    // Simulate a recalculation that was already running and re-created a record after the removal.
    await ComputedGrade.create({ student: extra.id, class: cls.id, schoolYear: cls.schoolYear, semester: cls.semester, period: 'MIDTERM' });
    await ensureCurrent(new mongoose.Types.ObjectId(cls.id));
    expect(await ComputedGrade.countDocuments({ student: extra.id })).toBe(0);
  });
});

describe('#6 / #7 / dates: malformed input is a 4xx, never a 500', () => {
  it('rejects repeated query parameters', async () => {
    const res = await me.get('/api/students?course=A&course=B');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ message: 'That could not be done. Reload the page and try again.', details: { source: 'query', field: 'course' } });
    expect((await me.get(`/api/quizzes?classId=${cls.id}&search=a&search=b`)).status).toBe(400);
  });

  it('rejects array student IDs in score and attendance lists', async () => {
    const quiz = await item('quizzes', 'MIDTERM', 'Q');
    expect((await me.put(`/api/quizzes/${quiz.id}/scores`, { revision: 0, scores: [{ studentId: [ana.id], score: 1 }] })).status).toBe(422);
    const session = (await me.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-01' })).body.data;
    expect((await me.put(`/api/attendance/sessions/${session.id}/records`, { revision: 0, records: [{ studentId: [ana.id], status: 'ABSENT' }] })).status).toBe(422);
    expect((await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [[ana.id]] })).status).toBe(422);
  });

  it('rejects malformed grading configuration components', async () => {
    const admin = await adminSession(app);
    const res = await admin.post('/api/grading/configuration', { periods: { MIDTERM: { components: [null] }, FINALS: { components: [] } } });
    expect(res.status).toBe(422);
  });

  it('rejects impossible calendar dates in filters', async () => {
    expect((await me.get(`/api/dashboard/overview?classId=${cls.id}&from=2026-02-31`)).status).toBe(422);
    expect((await me.get(`/api/attendance?classId=${cls.id}&to=2026-13-01`)).status).toBe(422);
  });
});

describe('#8 CSV headers are formula-safe', () => {
  it('escapes instructor-defined component labels in export headers', async () => {
    const config = (await me.get('/api/grading/configuration')).body.data;
    const periods = JSON.parse(JSON.stringify(config.periods));
    periods.MIDTERM.components[1].label = '=HYPERLINK("x")';
    const admin = await adminSession(app);
    expect((await admin.post('/api/grading/configuration', { periods })).status).toBe(201);
    const res = await me.get(`/api/grading/midterm/export?classId=${cls.id}`);
    expect(res.text).toContain(`"'=HYPERLINK(""x"") % (30%)"`);
    expect(res.text).not.toMatch(/,=HYPERLINK/);
  });
});
