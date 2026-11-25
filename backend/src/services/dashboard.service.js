/**
 * Dashboard statistics — computed from actual MongoDB records only.
 * Grade figures come from the grading engine (grading.service); attendance rates use the
 * official attendance formula from the grading calculator. No formula is re-implemented here.
 */
import mongoose from 'mongoose';
import { AttendanceRecord } from '../models/AttendanceRecord.js';
import { AttendanceSession } from '../models/AttendanceSession.js';
import { Enrollment } from '../models/Enrollment.js';
import { Student } from '../models/Student.js';
import { Class } from '../models/Class.js';
import { AuditLog } from '../models/AuditLog.js';
import { parseDateOnly, formatDateOnly } from '../utils/dates.js';
import { getOwnedClass } from './class.service.js';
import { findCurrentlyEnrolledStudentIds } from './enrollment.service.js';
import { attendancePercentage } from './grading/grading.calculator.js';
import { getClassGrades, summarize } from './grading/grading.service.js';

const { ObjectId } = mongoose.Types;
const PERIODS = ['MIDTERM', 'FINALS'];

function sessionFilter(classId, { period, from, to }) {
  const filter = { class: new ObjectId(String(classId)) };
  if (period) filter.period = period;
  if (from || to) {
    filter.sessionDate = {};
    if (from) filter.sessionDate.$gte = parseDateOnly(from);
    if (to) filter.sessionDate.$lte = parseDateOnly(to);
  }
  return filter;
}

/** Status counts per session (and totals), restricted by period/date range. */
async function attendanceBySession(classId, filters) {
  const sessions = await AttendanceSession.find(sessionFilter(classId, filters)).sort({ sessionDate: 1 }).lean();
  const rows = await AttendanceRecord.aggregate([
    { $match: { session: { $in: sessions.map((s) => s._id) } } },
    { $group: { _id: { session: '$session', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const counts = new Map(sessions.map((s) => [s._id.toString(), { present: 0, absent: 0, excused: 0, total: 0 }]));
  for (const { _id, n } of rows) {
    const c = counts.get(_id.session.toString());
    c[_id.status.toLowerCase()] += n;
    c.total += n;
  }
  return sessions.map((s) => {
    const c = counts.get(s._id.toString());
    return { sessionId: s._id.toString(), date: formatDateOnly(s.sessionDate), period: s.period, description: s.description ?? null, ...c, attendanceRate: attendancePercentage(c) };
  });
}

function totals(list) {
  const t = list.reduce((acc, s) => ({ present: acc.present + s.present, absent: acc.absent + s.absent, excused: acc.excused + s.excused, total: acc.total + s.total }), { present: 0, absent: 0, excused: 0, total: 0 });
  return { ...t, sessions: list.length, attendanceRate: attendancePercentage(t) };
}

const gradesPeriodParam = (period) => (period ? period.toLowerCase() : 'overall');

/**
 * The classes a dashboard request covers: the one requested, or — when no class is given —
 * every active class of the instructor ("All classes").
 */
async function scopeClasses(instructorId, classId) {
  if (classId) return [await getOwnedClass(instructorId, classId)];
  return Class.find({ instructor: instructorId, status: 'ACTIVE' }).sort({ schoolYear: -1, semester: 1, subjectCode: 1, section: 1 });
}

const classInfo = (cls) => ({ id: cls._id.toString(), subjectCode: cls.subjectCode, subjectTitle: cls.subjectTitle, section: cls.section });
const classLabel = (cls) => `${cls.subjectCode} · ${cls.section}`;

/** Grade rows of every class in scope, each tagged with its class (summaries reuse the engine's summarize). */
async function gradeRows(instructorId, classes, periodParam) {
  const perClass = await Promise.all(classes.map((cls) => getClassGrades(instructorId, cls._id.toString(), periodParam)));
  return perClass.flatMap((g, i) => g.rows.map((r) => ({ ...r, classId: classes[i]._id.toString(), classLabel: classLabel(classes[i]) })));
}

/** Sessions from several classes on the same date and period become one point on the trend. */
function mergeTrendByDate(sessions) {
  const byKey = new Map();
  for (const s of sessions) {
    const key = `${s.date}|${s.period}`;
    const m = byKey.get(key) ?? { sessionId: key, date: s.date, period: s.period, description: null, present: 0, absent: 0, excused: 0, total: 0, sessions: 0 };
    m.present += s.present;
    m.absent += s.absent;
    m.excused += s.excused;
    m.total += s.total;
    m.sessions += 1;
    byKey.set(key, m);
  }
  return [...byKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.period.localeCompare(b.period))
    .map((m) => ({ ...m, attendanceRate: attendancePercentage(m) }));
}

/**
 * Headline numbers for one class, or for all active classes when no class is given
 * (optionally one grading period / date range).
 */
export async function getOverview(instructorId, { classId, period, from, to }) {
  const classes = await scopeClasses(instructorId, classId);
  const [perClass, rosterSize, activeClassCount] = await Promise.all([
    Promise.all(classes.map(async (cls) => {
      const id = cls._id.toString();
      const [rosterIds, dropped, sessions, grades] = await Promise.all([
        findCurrentlyEnrolledStudentIds(id),
        Enrollment.countDocuments({ class: cls._id, status: 'DROPPED' }),
        attendanceBySession(id, { period, from, to }),
        getClassGrades(instructorId, id, gradesPeriodParam(period)),
      ]);
      return { cls, rosterIds, dropped, sessions, grades };
    })),
    Student.countDocuments({ instructor: instructorId, archivedAt: null }),
    Class.countDocuments({ instructor: instructorId, status: 'ACTIVE' }),
  ]);

  const s = summarize(perClass.flatMap((c) => c.grades.rows));
  // A student enrolled in two classes is one student (grades, though, are per class).
  const students = new Set(perClass.flatMap((c) => c.rosterIds.map(String)));
  return {
    scope: classId ? 'CLASS' : 'ALL',
    class: classId ? classInfo(classes[0]) : null,
    gradesPeriod: period ?? 'OVERALL',
    totalStudents: students.size,
    droppedStudents: perClass.reduce((n, c) => n + c.dropped, 0),
    attendance: totals(perClass.flatMap((c) => c.sessions)),
    studentsComplete: s.complete,
    studentsIncomplete: s.incomplete + s.lapsed,
    studentsNotComputable: s.notComputable,
    studentsPending: s.pending,
    classAverage: s.averagePercentage,
    passed: s.passed,
    instructor: { activeClasses: activeClassCount, activeStudents: rosterSize },
    // One line per class, so "All classes" can compare them side by side.
    classes: perClass.map((c) => {
      const cs = c.grades.summary;
      return {
        ...classInfo(c.cls),
        schoolYear: c.cls.schoolYear,
        semester: c.cls.semester,
        students: c.rosterIds.length,
        complete: cs.complete,
        passed: cs.passed,
        incomplete: cs.incomplete + cs.lapsed,
        dropped: c.dropped,
        average: cs.averagePercentage,
        attendanceRate: totals(c.sessions).attendanceRate,
      };
    }),
  };
}

/** Midterm / Finals attendance summaries and the per-session (or, for all classes, per-date) trend. */
export async function getAttendanceDashboard(instructorId, { classId, from, to }) {
  const classes = await scopeClasses(instructorId, classId);
  const sessions = (await Promise.all(classes.map((cls) => attendanceBySession(cls._id.toString(), { from, to })))).flat();
  return {
    periods: Object.fromEntries(PERIODS.map((p) => [p, totals(sessions.filter((s) => s.period === p))])),
    trend: classId ? sessions : mergeTrendByDate(sessions),
  };
}

function rankable(rows) {
  return rows.filter((r) => r.current && r.completionStatus === 'COMPLETE');
}

const brief = (r) => ({ studentId: r.studentId, studentNumber: r.studentNumber, fullName: r.fullName, percentage: r.percentage, grade: r.grade, remarks: r.remarks, classId: r.classId, classLabel: r.classLabel });

/** Performance per period, distribution, top/bottom students, incomplete records — one class or all. */
export async function getPerformanceDashboard(instructorId, { classId, period }) {
  const classes = await scopeClasses(instructorId, classId);
  const [midterm, finals, overall] = await Promise.all(['midterm', 'finals', 'overall'].map(async (p) => {
    const rows = await gradeRows(instructorId, classes, p);
    return { period: p.toUpperCase(), rows, summary: summarize(rows) };
  }));
  const byPeriod = { MIDTERM: midterm, FINALS: finals, OVERALL: overall };
  const focus = byPeriod[period ?? 'OVERALL'];

  const ranked = rankable(focus.rows).sort((a, b) => b.percentage - a.percentage || a.fullName.localeCompare(b.fullName));
  const incomplete = focus.rows
    .filter((r) => r.current && ['INCOMPLETE', 'INC_LAPSED'].includes(r.completionStatus))
    .map((r) => ({ ...brief(r), completionStatus: r.completionStatus, missingCount: r.missingItems.length, missingItems: r.missingItems.slice(0, 5) }));

  return {
    focusPeriod: focus.period,
    periods: Object.fromEntries(
      Object.entries(byPeriod).map(([key, data]) => [key, {
        classAverage: data.summary.averagePercentage,
        complete: data.summary.complete,
        incomplete: data.summary.incomplete + data.summary.lapsed,
        dropped: data.summary.dropped,
        notComputable: data.summary.notComputable,
        pending: data.summary.pending,
        passed: data.summary.passed,
        highestGrade: data.summary.highestGrade,
        lowestGrade: data.summary.lowestGrade,
      }]),
    ),
    distribution: focus.summary.distribution,
    top: ranked.slice(0, 5).map(brief),
    bottom: [...ranked].reverse().slice(0, 5).map(brief), // may overlap with `top` in small classes
    incomplete,
  };
}

/* ───────── Recent academic activity (from the audit log) ───────── */

const NOUNS = { QUIZ: 'quiz', ACTIVITY: 'activity', EXAMINATION: 'examination' };

function describe(entry) {
  const a = entry.action;
  const nv = entry.newValue ?? {};
  const pv = entry.previousValue ?? {};
  const md = entry.metadata ?? {};
  const assessment = /^(QUIZ|ACTIVITY|EXAMINATION)_(CREATE|UPDATE|DELETE|SCORES_UPDATE)$/.exec(a);
  if (assessment) {
    const noun = NOUNS[assessment[1]];
    if (assessment[2] === 'SCORES_UPDATE') return `Updated ${Array.isArray(nv) ? nv.length : ''} ${noun} score${Array.isArray(nv) && nv.length === 1 ? '' : 's'} — ${md.title ?? ''}`.trim();
    const title = nv.title ?? pv.title ?? '';
    return `${{ CREATE: 'Created', UPDATE: 'Edited', DELETE: 'Deleted' }[assessment[2]]} ${noun} “${title}”`;
  }
  switch (a) {
    case 'ATTENDANCE_SESSION_CREATE': return `Took attendance for ${nv.sessionDate} (${nv.period === 'FINALS' ? 'Finals' : 'Midterm'}, ${nv.students} students)`;
    case 'ATTENDANCE_SESSION_UPDATE': return `Edited attendance session ${nv.sessionDate}`;
    case 'ATTENDANCE_SESSION_DELETE': return `Deleted attendance session ${pv.sessionDate}`;
    case 'ATTENDANCE_RECORDS_UPDATE': return `Updated attendance for ${md.sessionDate} (${Array.isArray(nv) ? nv.length : 0} change${Array.isArray(nv) && nv.length === 1 ? '' : 's'})`;
    case 'ENROLLMENT_ADD': return `Enrolled ${(nv.enrolled ?? 0) + (nv.reinstated ?? 0)} student(s)`;
    case 'ENROLLMENT_DROP': return 'Dropped a student (DRP)';
    case 'ENROLLMENT_SELF': return `${nv.fullName ?? 'A student'} enrolled using the QR code${md.confirmedMismatch ? ` (entered ${md.entered}, not this class's section)` : ''}`;
    case 'CLASS_SELF_ENROLL_OPEN': return 'Opened QR enrollment';
    case 'CLASS_SELF_ENROLL_CLOSE': return 'Closed QR enrollment';
    case 'CLASS_SELF_ENROLL_NEW_LINK': return 'Replaced the QR enrollment link';
    case 'ENROLLMENT_REINSTATE': return 'Reinstated a dropped student';
    case 'ENROLLMENT_REMOVE': return 'Removed an enrollment';
    case 'STUDENT_IMPORT': return `Imported students (${nv.created ?? 0} new, ${nv.enrolledExisting ?? 0} existing enrolled)`;
    case 'CLASS_CREATE': return 'Created this class';
    case 'CLASS_UPDATE': return 'Edited class details';
    case 'GRADE_RECALCULATE_REQUEST': return `Recalculated grades (${md.recalculated ?? 0} students)`;
    case 'GRADE_INC_LAPSED': return 'An INC lapsed to 5.0 (completion period ended)';
    default: return null;
  }
}

/** Recent instructor actions in one class or all active classes, newest first (automatic recalculation entries omitted). */
export async function getRecentActivity(instructorId, { classId, limit = 15 }) {
  const classes = await scopeClasses(instructorId, classId);
  const labels = new Map(classes.map((c) => [c._id.toString(), classLabel(c)]));
  const entries = await AuditLog.find({ class: { $in: classes.map((c) => c._id) }, user: new ObjectId(String(instructorId)), action: { $nin: ['GRADE_RECALCULATE', 'GRADE_RECALCULATE_FAILED'] } })
    .sort({ createdAt: -1 })
    .limit(limit * 2)
    .lean();
  return entries
    .map((e) => ({ id: e._id.toString(), action: e.action, message: describe(e), at: e.createdAt, classId: e.class?.toString() ?? null, classLabel: labels.get(e.class?.toString()) ?? null }))
    .filter((e) => e.message)
    .slice(0, limit);
}
