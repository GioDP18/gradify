/**
 * Grading engine integration tests (Prompt.md §19.1 / §19.3): persisted grades must match the
 * official formula, recalculate on every relevant change, stay consistent under concurrency,
 * and never present stale results as current.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { ComputedGrade } from '../src/models/ComputedGrade.js';
import { GradingConfiguration } from '../src/models/GradingConfiguration.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { sweep } from '../src/services/grading/grading.service.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, adminSession, validStudent, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
let ana;
let ben;

const day = (n) => `2026-08-${String(n).padStart(2, '0')}`;

async function makeItem(kind, period, title, maxScore = 100) {
  return (await me.post(`/api/${kind}`, { classId: cls.id, title, period, date: '2026-09-10', maxScore })).body.data;
}
async function score(kind, item, entries) {
  const sheet = await me.get(`/api/${kind}/${item.id}/scores`);
  const res = await me.put(`/api/${kind}/${item.id}/scores`, { revision: sheet.body.data.assessment.revision, scores: entries });
  if (res.status !== 200) throw new Error(`score save failed ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}
async function sessions(period, count, absentees = {}) {
  for (let i = 1; i <= count; i += 1) {
    const s = (await me.post('/api/attendance/sessions', { classId: cls.id, period, sessionDate: period === 'MIDTERM' ? day(i) : `2026-07-${String(i).padStart(2, '0')}` })).body.data;
    const absent = absentees[i] ?? [];
    if (absent.length) {
      await me.put(`/api/attendance/sessions/${s.id}/records`, { revision: 0, records: absent.map((st) => ({ studentId: st.id, status: 'ABSENT' })) });
    }
  }
}
const grade = async (period, student) => (await me.get(`/api/grading/${period}/student/${student.id}?classId=${cls.id}`)).body.data.grade;

/**
 * Builds the owner's worked example for Ana:
 *   Midterm: attendance 90 (1 absence in 10), written 85, performance 88, exam 80 → 84.10% → 2.1
 *   Finals:  attendance 100, written 90, performance 92, exam 86              → 89.80% → 1.5
 *   Overall: 0.4·84.10 + 0.6·89.80 = 87.52% → 88 → 1.7
 * Ben gets 100 everywhere except he has no Midterm exam score yet.
 */
async function buildOwnerExample() {
  await sessions('MIDTERM', 10, { 3: [ana] });
  await sessions('FINALS', 1);
  const items = {
    MIDTERM: { quizzes: await makeItem('quizzes', 'MIDTERM', 'Quiz M'), activities: await makeItem('activities', 'MIDTERM', 'Activity M'), examinations: await makeItem('examinations', 'MIDTERM', 'Midterm Exam') },
    FINALS: { quizzes: await makeItem('quizzes', 'FINALS', 'Quiz F'), activities: await makeItem('activities', 'FINALS', 'Activity F'), examinations: await makeItem('examinations', 'FINALS', 'Final Exam') },
  };
  const anaScores = { MIDTERM: { quizzes: 85, activities: 88, examinations: 80 }, FINALS: { quizzes: 90, activities: 92, examinations: 86 } };
  for (const period of ['MIDTERM', 'FINALS']) {
    for (const kind of ['quizzes', 'activities', 'examinations']) {
      const entries = [{ studentId: ana.id, score: anaScores[period][kind] }];
      if (!(period === 'MIDTERM' && kind === 'examinations')) entries.push({ studentId: ben.id, score: 100 });
      await score(kind, items[period][kind], entries);
    }
  }
  return items;
}

beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
  ana = (await me.post(`/api/students?classId=${cls.id}`, validStudent({ firstName: 'Ana', lastName: 'Bautista' }))).body.data;
  ben = (await me.post(`/api/students?classId=${cls.id}`, validStudent({ firstName: 'Ben', lastName: 'Cruz' }))).body.data;
});

describe('persisted grades match the official formula', () => {
  it('reproduces the owner example end to end (84.10 → 2.1, 89.80 → 1.5, 87.52 → 1.7)', async () => {
    await buildOwnerExample();

    const mid = await grade('midterm', ana);
    expect(mid).toMatchObject({ current: true, completionStatus: 'COMPLETE', grade: 2.1, roundedPercent: 84, remarks: 'Very Good' });
    expect(mid.percentage).toBeCloseTo(84.1, 9);
    expect(mid.components.map((c) => [c.key, c.weight, c.percentage, c.weightedContribution])).toEqual([
      ['ATTENDANCE', 10, 90, 9], ['WRITTEN', 30, 85, 25.5], ['PERFORMANCE', 20, 88, 17.6], ['EXAM', 40, 80, 32],
    ]);
    expect(mid.components[0]).toMatchObject({ present: 9, absent: 1, excused: 0, maxScore: 10 });

    const fin = await grade('finals', ana);
    expect(fin.percentage).toBeCloseTo(89.8, 9);
    expect(fin.grade).toBe(1.5);

    const overall = await grade('overall', ana);
    expect(overall).toMatchObject({ completionStatus: 'COMPLETE', grade: 1.7, roundedPercent: 88, remarks: 'Superior' });
    expect(overall.percentage).toBeCloseTo(87.52, 9);
    expect(overall.periodResults.MIDTERM).toMatchObject({ grade: 2.1, weight: 40 });
    expect(overall.periodResults.FINALS).toMatchObject({ grade: 1.5, weight: 60 });
  });

  it('keeps exactly one computed grade per student × period, with configuration and calculation versions', async () => {
    await buildOwnerExample();
    expect(await ComputedGrade.countDocuments({ class: cls.id })).toBe(6);
    const doc = await ComputedGrade.findOne({ student: ana.id, period: 'MIDTERM' }).lean();
    expect(doc).toMatchObject({ configVersion: 1, calculationVersion: '1.0.0', calcStatus: 'CURRENT', schoolYear: '2026-2027', semester: 'FIRST' });
    expect(doc.calculatedRevision).toBe(doc.sourceRevision);
  });
});

describe('missing scores and INC', () => {
  it('shows INC with the missing item, then a grade once the score is entered (auto-recalculation)', async () => {
    const items = await buildOwnerExample();
    const inc = await grade('midterm', ben);
    expect(inc).toMatchObject({ completionStatus: 'INCOMPLETE', grade: null, percentage: null, remarks: 'INC' });
    expect(inc.missingItems).toEqual([expect.objectContaining({ component: 'EXAM', title: 'Midterm Exam' })]);
    expect((await grade('overall', ben)).remarks).toBe('INC');

    await score('examinations', items.MIDTERM.examinations, [{ studentId: ben.id, score: 100 }]);
    const after = await ComputedGrade.findOne({ student: ben.id, period: 'MIDTERM' }).lean(); // recalculated after commit, before any read
    expect(after).toMatchObject({ completionStatus: 'COMPLETE', grade: 1.0, calcStatus: 'CURRENT' });
    expect((await grade('overall', ben)).grade).toBe(1.0);
  });

  it('editing a score recalculates; clearing it (no score) brings back INC — never zero', async () => {
    const items = await buildOwnerExample();
    await score('quizzes', items.MIDTERM.quizzes, [{ studentId: ana.id, score: 95 }]);
    expect((await grade('midterm', ana)).percentage).toBeCloseTo(87.1, 9); // +3 points of the 30% weight
    await score('quizzes', items.MIDTERM.quizzes, [{ studentId: ana.id, score: null }]);
    const g = await grade('midterm', ana);
    expect(g.completionStatus).toBe('INCOMPLETE');
    expect(g.missingItems[0].title).toBe('Quiz M');
  });

  it('deleting an assessment recalculates without it', async () => {
    await buildOwnerExample();
    const extra = await makeItem('quizzes', 'MIDTERM', 'Quiz M2', 10);
    expect((await grade('midterm', ana)).completionStatus).toBe('INCOMPLETE'); // new published item is required
    await me.del(`/api/quizzes/${extra.id}`);
    expect((await grade('midterm', ana)).grade).toBe(2.1);
  });

  it('a component with no items makes the period not computable (no reweighting)', async () => {
    await sessions('MIDTERM', 1);
    const q = await makeItem('quizzes', 'MIDTERM', 'Quiz');
    const e = await makeItem('examinations', 'MIDTERM', 'Exam');
    await score('quizzes', q, [{ studentId: ana.id, score: 90 }]);
    await score('examinations', e, [{ studentId: ana.id, score: 90 }]);
    const g = await grade('midterm', ana);
    expect(g).toMatchObject({ completionStatus: 'NOT_COMPUTABLE', grade: null });
    expect(g.emptyComponents).toEqual([{ component: 'PERFORMANCE', componentLabel: 'Performance Tasks/Assignments' }]);
  });
});

describe('Midterm / Finals isolation', () => {
  it('a Midterm change never touches the Finals grade record', async () => {
    const items = await buildOwnerExample();
    const finalsBefore = await ComputedGrade.findOne({ student: ana.id, period: 'FINALS' }).lean();
    await score('quizzes', items.MIDTERM.quizzes, [{ studentId: ana.id, score: 70 }]);
    const finalsAfter = await ComputedGrade.findOne({ student: ana.id, period: 'FINALS' }).lean();
    expect(finalsAfter.sourceRevision).toBe(finalsBefore.sourceRevision);
    expect(finalsAfter.percentage).toBe(finalsBefore.percentage);
    const midAfter = await ComputedGrade.findOne({ student: ana.id, period: 'MIDTERM' }).lean();
    expect(midAfter.sourceRevision).toBeGreaterThan(0);
  });
});

describe('DRP', () => {
  it('dropping a student shows DRP; reinstating restores the computed grade', async () => {
    await buildOwnerExample();
    await me.put(`/api/classes/${cls.id}/enrollments/${ana.id}`, { status: 'DROPPED' });
    expect(await grade('overall', ana)).toMatchObject({ completionStatus: 'DROPPED', remarks: 'DRP', grade: null });
    expect((await grade('midterm', ana)).remarks).toBe('DRP');
    await me.put(`/api/classes/${cls.id}/enrollments/${ana.id}`, { status: 'ENROLLED' });
    expect((await grade('overall', ana)).grade).toBe(1.7);
  });
});

describe('consistency and failure handling', () => {
  it('concurrent score saves on different items still end with the correct, current grade', async () => {
    const items = await buildOwnerExample();
    const [q, a, e] = ['quizzes', 'activities', 'examinations'];
    await Promise.all([
      score(q, items.MIDTERM.quizzes, [{ studentId: ana.id, score: 100 }]),
      score(a, items.MIDTERM.activities, [{ studentId: ana.id, score: 100 }]),
      score(e, items.MIDTERM.examinations, [{ studentId: ana.id, score: 100 }]),
    ]);
    const doc = await ComputedGrade.findOne({ student: ana.id, period: 'MIDTERM' }).lean();
    expect(doc.calcStatus).toBe('CURRENT');
    expect(doc.calculatedRevision).toBe(doc.sourceRevision);
    expect(doc.percentage).toBeCloseTo(9 + 30 + 20 + 40, 9); // attendance still 90%
  });

  it('a failed recalculation keeps the last result but never presents it as current; the next read repairs it', async () => {
    const items = await buildOwnerExample();
    // Break the configuration so the calculator throws (no conversion band).
    const config = await GradingConfiguration.findOne({ isActive: true });
    const goodTable = config.gradeConversion;
    await GradingConfiguration.updateOne({ _id: config._id }, { $set: { 'gradeConversion.table': [] } });

    await score('quizzes', items.MIDTERM.quizzes, [{ studentId: ana.id, score: 60 }]);
    const failed = await ComputedGrade.findOne({ student: ana.id, period: 'MIDTERM' }).lean();
    expect(failed.calcStatus).toBe('FAILED');
    expect(failed.grade).toBe(2.1); // last known result preserved…
    expect(await AuditLog.countDocuments({ action: 'GRADE_RECALCULATE_FAILED' })).toBeGreaterThan(0);

    // …but never served as current.
    const sheet = await me.get(`/api/grading/midterm?classId=${cls.id}`);
    const row = sheet.body.data.rows.find((r) => r.studentId === ana.id);
    expect(row).toMatchObject({ current: false, grade: null, calcStatus: 'FAILED' });
    expect(row.lastKnown.grade).toBe(2.1);
    expect(sheet.body.data.summary.pending).toBeGreaterThan(0);

    await GradingConfiguration.updateOne({ _id: config._id }, { $set: { gradeConversion: goodTable } });
    const repaired = await grade('midterm', ana);
    expect(repaired.current).toBe(true);
    expect(repaired.percentage).toBeCloseTo(9 + 18 + 17.6 + 32, 9);
  });

  it('the sweep repairs stale grades left behind (e.g. after a crash)', async () => {
    await buildOwnerExample();
    await ComputedGrade.updateMany({ class: cls.id }, { $inc: { sourceRevision: 1 }, $set: { calcStatus: 'STALE' } });
    const result = await sweep();
    expect(result.classes).toBeGreaterThanOrEqual(1);
    expect(await ComputedGrade.countDocuments({ class: cls.id, calcStatus: { $ne: 'CURRENT' } })).toBe(0);
  });
});

describe('INC completion deadline (D18)', () => {
  it('an INC past termEndDate + 1 year lapses to 5.0, is frozen, and blocks further score changes', async () => {
    const items = await buildOwnerExample();
    // Move the term two years back so Ben's INC deadline has passed.
    await me.put(`/api/classes/${cls.id}`, { termEndDate: '2024-01-15' });
    const overall = await grade('overall', ben);
    expect(overall).toMatchObject({ completionStatus: 'INC_LAPSED', grade: 5.0, remarks: 'Failure (INC lapsed)' });
    expect(overall.lapsedAt).not.toBeNull();
    expect(new Date(overall.incDeadline).toISOString().slice(0, 10)).toBe('2025-01-15');
    expect(await AuditLog.countDocuments({ action: 'GRADE_INC_LAPSED' })).toBe(1);

    const sheet = await me.get(`/api/examinations/${items.MIDTERM.examinations.id}/scores`);
    const res = await me.put(`/api/examinations/${items.MIDTERM.examinations.id}/scores`, { revision: sheet.body.data.assessment.revision, scores: [{ studentId: ben.id, score: 100 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INC_LAPSED');
    expect((await grade('overall', ben)).grade).toBe(5.0);
    // Ana (complete) is unaffected by the deadline.
    expect((await grade('overall', ana)).grade).toBe(1.7);
  });

  it('within the deadline the INC stays INC and shows its deadline', async () => {
    await buildOwnerExample();
    const overall = await grade('overall', ben);
    expect(overall.completionStatus).toBe('INCOMPLETE');
    expect(new Date(overall.incDeadline).toISOString().slice(0, 10)).toBe('2027-12-18');
  });
});

describe('grading API', () => {
  it('returns class sheets per period with a summary and the configuration in use', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/overall?classId=${cls.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.period).toBe('OVERALL');
    expect(res.body.data.rows.map((r) => r.fullName)).toEqual(['Bautista, Ana P.', 'Cruz, Ben P.']);
    expect(res.body.data.summary).toMatchObject({ totalStudents: 2, complete: 1, incomplete: 1, highestGrade: 1.7, lowestGrade: 1.7, passed: 1 });
    expect(res.body.data.summary.averagePercentage).toBeCloseTo(87.52, 9);
    expect(res.body.data.configuration.periodWeights).toEqual({ MIDTERM: 40, FINALS: 60 });

    const summary = await me.get(`/api/grading/midterm/summary?classId=${cls.id}`);
    expect(summary.body.data.summary.distribution.find((d) => d.label === '2.0–2.4').count).toBe(1);
  });

  it('returns a full student report including both periods for the overall grade', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/overall/student/${ana.id}?classId=${cls.id}`);
    expect(res.body.data.grade.student).toMatchObject({ studentNumber: ana.studentNumber, course: 'BSIT' });
    expect(res.body.data.grade.periods.MIDTERM.grade).toBe(2.1);
    expect(res.body.data.grade.periods.FINALS.grade).toBe(1.5);
    expect(res.body.data.class.subjectCode).toBe('IT 101');
  });

  it('lists a student’s grades across classes', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/student/${ana.id}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].grades.OVERALL.grade).toBe(1.7);
  });

  it('validates the period and protects other instructors’ classes', async () => {
    expect((await me.get(`/api/grading/prelim?classId=${cls.id}`)).status).toBe(422);
    expect((await me.get('/api/grading/midterm')).status).toBe(422);
    const other = await instructorSession(app);
    expect((await other.get(`/api/grading/midterm?classId=${cls.id}`)).status).toBe(404);
    expect((await other.post('/api/grading/recalculate', { classId: cls.id })).status).toBe(404);
  });

  it('manual recalculation reports what was recalculated and is audited', async () => {
    await buildOwnerExample();
    const res = await me.post('/api/grading/recalculate', { classId: cls.id });
    expect(res.body.data).toEqual({ recalculated: 2, failed: 0 });
    expect(await AuditLog.countDocuments({ action: 'GRADE_RECALCULATE_REQUEST' })).toBe(1);
  });

  it('manual recalculation of one student recalculates only that student', async () => {
    await buildOwnerExample();
    const res = await me.post('/api/grading/recalculate', { classId: cls.id, studentId: ana.id });
    expect(res.body.data).toEqual({ recalculated: 1, failed: 0 });
    const audit = await AuditLog.findOne({ action: 'GRADE_RECALCULATE_REQUEST' }).lean();
    expect(audit.metadata.studentId).toBe(ana.id);
    expect((await me.get(`/api/grading/overall/student/${ana.id}?classId=${cls.id}`)).body.data.grade.grade).toBe(1.7);

    // A student who is not in the class, or a malformed id, is refused.
    const outsider = (await me.post('/api/students', validStudent({ firstName: 'Zed', lastName: 'Outsider' }))).body.data;
    expect((await me.post('/api/grading/recalculate', { classId: cls.id, studentId: outsider.id })).status).toBe(404);
    expect((await me.post('/api/grading/recalculate', { classId: cls.id, studentId: 'nope' })).status).toBe(422);
  });
});

describe('exports (built from persisted grades only)', () => {
  const binary = (res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('exports the class sheet as CSV with title, weights, components, grades, and INC details', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/midterm/export?classId=${cls.id}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/evsu-grades-IT-101-BSIT-1A-midterm-\d{8}\.csv/);
    const text = res.text.replace(/^﻿/, '');
    expect(text).toContain('"Gradify — EVSU Grading System"');
    expect(text).toContain('Official weights: Attendance 10% · Written Tasks/Quizzes 30% · Performance Tasks/Assignments 20% · Exam (Mid-term) 40%');
    expect(text).toContain('Student Number,Student Name,Attendance % (10%),Written Tasks/Quizzes % (30%),Performance Tasks/Assignments % (20%),Exam (Mid-term) % (40%),Computed %,Grade,Remarks,Missing Requirements');
    // Names contain a comma, so CSV correctly quotes them.
    expect(text).toMatch(/"Bautista, Ana P\.",90\.00,85\.00,88\.00,80\.00,84\.10,2\.1,Very Good,/);
    expect(text).toMatch(/"Cruz, Ben P\.",100\.00,100\.00,100\.00,,,,INC,Midterm Exam/);
  });

  it('exports the overall sheet with both periods', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/overall/export?classId=${cls.id}`);
    expect(res.text).toContain('Midterm % (40%),Midterm Grade,Finals % (60%),Finals Grade,Computed %,Grade,Remarks');
    expect(res.text).toMatch(/"Bautista, Ana P\.",84\.10,2\.1,89\.80,1\.5,87\.52,1\.7,Superior/);
  });

  it('exports an Excel workbook that opens with the same values', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/overall/export?classId=${cls.id}&format=xlsx`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Gradify — EVSU Grading System');
    const values = [];
    ws.eachRow((row) => values.push(row.values.slice(1).join('|')));
    expect(values.some((v) => v.startsWith(`${ana.studentNumber}|Bautista, Ana P.|84.10|2.1|89.80|1.5|87.52|1.7|Superior`))).toBe(true);
  });

  it('exports an individual report with the component breakdown for each period', async () => {
    await buildOwnerExample();
    const res = await me.get(`/api/grading/overall/student/${ana.id}/export?classId=${cls.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Individual Grade Report — Overall (Final Grade)');
    expect(res.text).toContain('Result: 87.52% → 1.7 (Superior)');
    expect(res.text).toContain('Component,Raw Score,Maximum Possible,Percentage,Official Weight,Weighted Contribution');
    expect(res.text).toContain('Attendance,"9 (P 9, E 0, A 1)",10,90.00,10%,9.00');
    expect(res.text).toContain('Exam (Final Exam),86,100,86.00,40%,34.40');

    const xlsx = await me.get(`/api/grading/midterm/student/${ana.id}/export?classId=${cls.id}&format=xlsx`).buffer(true).parse(binary);
    expect(xlsx.status).toBe(200);
  });

  it('never exports another instructor’s class and validates the format', async () => {
    const other = await instructorSession(app);
    expect((await other.get(`/api/grading/midterm/export?classId=${cls.id}`)).status).toBe(404);
    expect((await me.get(`/api/grading/midterm/export?classId=${cls.id}&format=pdf`)).status).toBe(422);
  });
});

describe('grading configuration versioning', () => {
  it('a new version recalculates every grade with the new weights and keeps history', async () => {
    await buildOwnerExample();
    const current = (await me.get('/api/grading/configuration')).body.data;
    expect(current.version).toBe(1);

    // Instructors can read the shared criteria but not change them (D21).
    expect((await me.post('/api/grading/configuration', { periodWeights: { MIDTERM: 50, FINALS: 50 } })).status).toBe(403);

    const admin = await adminSession(app);
    const res = await admin.post('/api/grading/configuration', { periodWeights: { MIDTERM: 50, FINALS: 50 }, notes: 'Equal weighting test' });
    expect(res.status).toBe(201);
    expect(res.body.data.configuration.version).toBe(2);
    expect(res.body.data.classesToRecalculate).toBe(1);
    expect((await ComputedGrade.findOne({ student: ana.id, period: 'OVERALL' }).lean()).calcStatus).toBe('STALE');

    // 0.5·84.10 + 0.5·89.80 = 86.95 → 87 → 1.8
    const overall = await grade('overall', ana);
    expect(overall.percentage).toBeCloseTo(86.95, 9);
    expect(overall.grade).toBe(1.8);
    expect((await ComputedGrade.findOne({ student: ana.id, period: 'OVERALL' }).lean()).configVersion).toBe(2);

    const versions = (await me.get('/api/grading/configuration/versions')).body.data;
    expect(versions.map((v) => [v.version, v.isActive, v.periodWeights.MIDTERM])).toEqual([[2, true, 50], [1, false, 40]]);
  });

  it('rejects invalid configurations without changing anything', async () => {
    const admin = await adminSession(app);
    const res = await admin.post('/api/grading/configuration', { periodWeights: { MIDTERM: 50, FINALS: 60 } });
    expect(res.status).toBe(422);
    expect((await me.get('/api/grading/configuration')).body.data.version).toBe(1);
  });
});
