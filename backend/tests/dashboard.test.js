import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
let students; // a, b, c

async function item(kind, period, title) {
  return (await me.post(`/api/${kind}`, { classId: cls.id, title, period, date: '2026-09-10', maxScore: 100 })).body.data;
}
async function score(kind, it, entries) {
  const sheet = await me.get(`/api/${kind}/${it.id}/scores`);
  await me.put(`/api/${kind}/${it.id}/scores`, { revision: sheet.body.data.assessment.revision, scores: entries });
}

/**
 * Midterm: 2 sessions (Sep 1: A absent; Sep 8: B excused). Finals: 1 session (Nov 3, all present).
 * Midterm scores (all components 100 max): A 90s, B 70s, C missing the exam → INC.
 * Expected midterm attendance: A 1/2 = 50%, B 2/2 = 100% (excused counts), C 100%.
 */
beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
  students = [];
  for (const name of ['Ana', 'Ben', 'Carla']) students.push((await me.post(`/api/students?classId=${cls.id}`, validStudent({ firstName: name, lastName: `${name}son` }))).body.data);
  const [a, b, c] = students;

  const s1 = (await me.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-01' })).body.data;
  await me.put(`/api/attendance/sessions/${s1.id}/records`, { revision: 0, records: [{ studentId: a.id, status: 'ABSENT' }] });
  const s2 = (await me.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-08' })).body.data;
  await me.put(`/api/attendance/sessions/${s2.id}/records`, { revision: 0, records: [{ studentId: b.id, status: 'EXCUSED' }] });
  await me.post('/api/attendance/sessions', { classId: cls.id, period: 'FINALS', sessionDate: '2026-11-03' });

  for (const kind of ['quizzes', 'activities', 'examinations']) {
    const it = await item(kind, 'MIDTERM', `${kind} M`);
    const entries = [{ studentId: a.id, score: 90 }, { studentId: b.id, score: 70 }];
    if (kind !== 'examinations') entries.push({ studentId: c.id, score: 80 });
    await score(kind, it, entries);
  }
});

describe('GET /api/dashboard/overview', () => {
  it('counts students and attendance from real records and uses engine grade results', async () => {
    const res = await me.get(`/api/dashboard/overview?classId=${cls.id}&period=MIDTERM`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totalStudents).toBe(3);
    expect(d.attendance).toMatchObject({ sessions: 2, present: 4, absent: 1, excused: 1, total: 6 });
    expect(d.attendance.attendanceRate).toBeCloseTo((5 / 6) * 100, 9); // (P + E) ÷ total
    expect(d.gradesPeriod).toBe('MIDTERM');
    expect(d).toMatchObject({ studentsComplete: 2, studentsIncomplete: 1, passed: 1 });
    // A: 10·0.5 + 30·0.9 + 20·0.9 + 40·0.9 = 86 ; B: 10·1 + 0.7·(30+20+40) = 73 → average 79.5
    expect(d.classAverage).toBeCloseTo(79.5, 9);
    expect(d.instructor).toEqual({ activeClasses: 1, activeStudents: 3 });
  });

  it('applies the date range and period filters to attendance', async () => {
    const ranged = await me.get(`/api/dashboard/overview?classId=${cls.id}&from=2026-09-05&to=2026-12-31`);
    expect(ranged.body.data.attendance).toMatchObject({ sessions: 2, present: 5, excused: 1, absent: 0 });
    const finals = await me.get(`/api/dashboard/overview?classId=${cls.id}&period=FINALS`);
    expect(finals.body.data.attendance).toMatchObject({ sessions: 1, present: 3 });
  });

  it('defaults to the final (overall) grade when no period is chosen', async () => {
    const res = await me.get(`/api/dashboard/overview?classId=${cls.id}`);
    expect(res.body.data.gradesPeriod).toBe('OVERALL');
  });
});

describe('GET /api/dashboard/attendance', () => {
  it('summarizes Midterm and Finals separately with a per-session trend', async () => {
    const res = await me.get(`/api/dashboard/attendance?classId=${cls.id}`);
    const d = res.body.data;
    expect(d.periods.MIDTERM).toMatchObject({ sessions: 2, present: 4, absent: 1, excused: 1 });
    expect(d.periods.FINALS).toMatchObject({ sessions: 1, present: 3, absent: 0, attendanceRate: 100 });
    expect(d.trend.map((t) => [t.date, t.period, t.absent])).toEqual([['2026-09-01', 'MIDTERM', 1], ['2026-09-08', 'MIDTERM', 0], ['2026-11-03', 'FINALS', 0]]);
    expect(d.trend[0].attendanceRate).toBeCloseTo((2 / 3) * 100, 9);
  });
});

describe('GET /api/dashboard/performance', () => {
  it('ranks students by the engine’s percentages and lists incomplete records', async () => {
    const res = await me.get(`/api/dashboard/performance?classId=${cls.id}&period=MIDTERM`);
    const d = res.body.data;
    expect(d.focusPeriod).toBe('MIDTERM');
    expect(d.top.map((s) => s.fullName)).toEqual(['Anason, Ana P.', 'Benson, Ben P.']);
    expect(d.top[0]).toMatchObject({ grade: 1.9, remarks: 'Superior' }); // 86% → 86 → (105 − 86) ÷ 10 = 1.9
    expect(d.top[1]).toMatchObject({ grade: 4.0, remarks: 'Conditional Failure' }); // 73% → 70–74 band → 4.0
    expect(d.bottom[0].fullName).toBe('Benson, Ben P.');
    expect(d.incomplete).toEqual([expect.objectContaining({ fullName: 'Carlason, Carla P.', missingCount: 1 })]);
    expect(d.periods.MIDTERM.classAverage).toBeCloseTo(79.5, 9);
    expect(d.periods.FINALS.notComputable).toBe(3); // no finals assessments yet
    expect(d.distribution.find((x) => x.label === 'INC').count).toBe(1);
  });
});

describe('GET /api/dashboard/activity', () => {
  it('lists readable recent actions for the class, newest first', async () => {
    const res = await me.get(`/api/dashboard/activity?classId=${cls.id}&limit=5`);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.data[0].message).toMatch(/Updated 2 examination scores — examinations M/);
    expect(res.body.data.every((e) => typeof e.message === 'string' && e.at)).toBe(true);
  });
});

describe('authorization', () => {
  it('never shows another instructor’s class', async () => {
    const other = await instructorSession(app);
    for (const path of ['overview', 'attendance', 'performance', 'activity']) {
      expect((await other.get(`/api/dashboard/${path}?classId=${cls.id}`)).status).toBe(404);
    }
    expect((await me.get('/api/dashboard/overview?classId=not-an-id')).status).toBe(422);
  });
});

/**
 * "All classes" (no classId): a second class IT 102 with Ana (also in IT 101) and Dan.
 * Midterm: one session on Sep 1 (Dan absent); every component 100 max — Ana 100, Dan 80.
 * Ana in IT 102: 10 + 30 + 20 + 40 = 100%. Dan: attendance 0/1 → 0 + 0.8 × 90 = 72%.
 */
describe('all classes (no classId)', () => {
  let cls2;
  beforeEach(async () => {
    cls2 = (await me.post('/api/classes', validClass({ subjectCode: 'IT 102', section: 'BSIT-1B' }))).body.data;
    const dan = (await me.post(`/api/students?classId=${cls2.id}`, validStudent({ firstName: 'Dan', lastName: 'Danson' }))).body.data;
    const ana = students[0];
    await me.post(`/api/classes/${cls2.id}/enrollments`, { studentIds: [ana.id] });
    const s = (await me.post('/api/attendance/sessions', { classId: cls2.id, period: 'MIDTERM', sessionDate: '2026-09-01' })).body.data;
    await me.put(`/api/attendance/sessions/${s.id}/records`, { revision: 0, records: [{ studentId: dan.id, status: 'ABSENT' }] });
    for (const kind of ['quizzes', 'activities', 'examinations']) {
      const it = (await me.post(`/api/${kind}`, { classId: cls2.id, title: `${kind} 2`, period: 'MIDTERM', date: '2026-09-10', maxScore: 100 })).body.data;
      await me.put(`/api/${kind}/${it.id}/scores`, { revision: 0, scores: [{ studentId: ana.id, score: 100 }, { studentId: dan.id, score: 80 }] });
    }
  });

  it('overview combines every active class and lists each class', async () => {
    const res = await me.get('/api/dashboard/overview?period=MIDTERM');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.scope).toBe('ALL');
    expect(d.class).toBeNull();
    expect(d.totalStudents).toBe(4); // Ana counts once although she is in both classes
    expect(d.attendance).toMatchObject({ sessions: 3, present: 5, absent: 2, excused: 1, total: 8 });
    expect(d).toMatchObject({ studentsComplete: 4, studentsIncomplete: 1, passed: 2 });
    expect(d.classAverage).toBeCloseTo((86 + 73 + 100 + 72) / 4, 9);
    expect(d.instructor.activeClasses).toBe(2);
    expect(d.classes.map((c) => [c.subjectCode, c.students, c.passed])).toEqual([['IT 101', 3, 1], ['IT 102', 2, 1]]);
    expect(d.classes[1].average).toBeCloseTo(86, 9);

    const one = (await me.get(`/api/dashboard/overview?classId=${cls2.id}&period=MIDTERM`)).body.data;
    expect(one).toMatchObject({ scope: 'CLASS', totalStudents: 2, studentsComplete: 2 });
  });

  it('attendance merges sessions held on the same date across classes', async () => {
    const d = (await me.get('/api/dashboard/attendance')).body.data;
    expect(d.periods.MIDTERM).toMatchObject({ sessions: 3, absent: 2 });
    expect(d.trend.map((t) => [t.date, t.absent, t.total])).toEqual([['2026-09-01', 2, 5], ['2026-09-08', 0, 3], ['2026-11-03', 0, 3]]);
  });

  it('performance ranks students across classes and tags each with its class', async () => {
    const d = (await me.get('/api/dashboard/performance?period=MIDTERM')).body.data;
    expect(d.top[0]).toMatchObject({ fullName: 'Anason, Ana P.', classId: cls2.id, classLabel: 'IT 102 · BSIT-1B', grade: 1.0 });
    expect(d.top).toHaveLength(4);
    expect(d.incomplete).toEqual([expect.objectContaining({ fullName: 'Carlason, Carla P.', classId: cls.id })]);
    expect(d.periods.MIDTERM.complete).toBe(4);
  });

  it('activity covers every class with its label; archived classes are left out', async () => {
    const all = (await me.get('/api/dashboard/activity?limit=50')).body.data;
    expect(new Set(all.map((e) => e.classLabel))).toEqual(new Set(['IT 101 · BSIT-1A', 'IT 102 · BSIT-1B']));
    await me.del(`/api/classes/${cls2.id}`);
    const after = (await me.get('/api/dashboard/overview')).body.data;
    expect(after.classes.map((c) => c.subjectCode)).toEqual(['IT 101']);
  });
});
