/**
 * What the assistant can look up to answer questions about the signed-in person's own records.
 *
 * Every lookup is READ-ONLY and goes through the same services the pages use, with the signed-in
 * user's id, so an instructor's assistant can only ever read that instructor's classes and
 * students (anything else is "not found"), and the administrator's only the account list.
 * Nothing here can change a record.
 *
 * Whatever a lookup returns is sent to the AI service to write the answer, so results are kept
 * to what answers need: names, student numbers, scores and grades. Email addresses, sign-in
 * names and private links are never included.
 */
import mongoose from 'mongoose';
import { ROLES } from '../../models/User.js';
import { ASSESSMENT_TYPES } from '../../models/assessments.js';
import { listClasses } from '../class.service.js';
import { getOverview } from '../dashboard.service.js';
import { getClassGrades, getStudentGradesAcrossClasses } from '../grading/grading.service.js';
import { getSummary as getAttendanceSummary } from '../attendance.service.js';
import { createAssessmentService } from '../assessment.service.js';
import { listStudents } from '../student.service.js';
import { listAccounts } from '../admin.service.js';
import { GUIDE, GUIDE_TOPICS } from './knowledge.js';

const SEMESTERS = { FIRST: '1st Semester', SECOND: '2nd Semester', SUMMER: 'Summer' };
const MAX_ROWS = 120;

const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : null);
const className = (c) => `${c.subjectCode} · ${c.section}`;
const isId = (value) => typeof value === 'string' && mongoose.isValidObjectId(value);

class ToolInputError extends Error {}
const needId = (value, what) => {
  if (!isId(value)) throw new ToolInputError(`${what} must be an id taken from an earlier result.`);
  return value;
};

/** Which students a class listing shows. */
const SHOW = {
  all: () => true,
  failing: (r, passing) => typeof r.grade === 'number' && r.grade > passing,
  passing: (r, passing) => typeof r.grade === 'number' && r.grade <= passing,
  incomplete: (r) => r.completionStatus === 'INCOMPLETE',
  dropped: (r) => r.completionStatus === 'DROPPED',
};
const ORDER = {
  name: () => 0, // already alphabetical
  best: (a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (b.percentage ?? -1) - (a.percentage ?? -1),
  worst: (a, b) => (b.grade ?? -1) - (a.grade ?? -1) || (a.percentage ?? 999) - (b.percentage ?? 999),
};

/** One student's result for one period as one short line (a table row costs far fewer words than an object). */
const GRADE_COLUMNS = 'name | student number | status | percent | grade | remarks | missing';
function gradeLine(row) {
  const missing = row.missingItems?.length ? row.missingItems.map((m) => m.title).slice(0, 6).join('; ') : '';
  return [row.fullName, row.studentNumber, row.completionStatus, round(row.percentage) ?? '', row.grade ?? '', row.remarks ?? '', missing].join(' | ');
}

/** A period's result with its components (attendance, quizzes, activities, exam). */
function gradeDetail(grade) {
  if (!grade) return null;
  return {
    status: grade.completionStatus,
    percent: round(grade.percentage),
    roundedPercent: grade.roundedPercent ?? null,
    grade: grade.grade ?? null,
    remarks: grade.remarks ?? null,
    ...(grade.components?.length
      ? { components: grade.components.map((c) => ({ component: c.label, weight: c.weight, score: c.rawScore, outOf: c.maxScore, percent: round(c.percentage), weighted: round(c.weightedContribution), ...(c.key === 'ATTENDANCE' ? { present: c.present, absent: c.absent, excused: c.excused } : {}) })) }
      : {}),
    ...(grade.periodResults
      ? { periods: Object.fromEntries(Object.entries(grade.periodResults).map(([period, r]) => [period, { status: r.status, percent: round(r.percentage), grade: r.grade ?? null, weight: r.weight, weighted: round(r.weightedContribution) }])) }
      : {}),
    ...(grade.missingItems?.length ? { missing: grade.missingItems.map((m) => `${m.componentLabel ?? m.component}: ${m.title}`).slice(0, 15) } : {}),
    ...(grade.incDeadline ? { incDeadline: String(grade.incDeadline).slice(0, 10) } : {}),
  };
}

/** The instructor's classes with their headline numbers (used for the tool and for the prompt). */
export async function classList(userId) {
  const [classes, overview] = await Promise.all([listClasses(userId), getOverview(userId, {})]);
  const stats = new Map((overview.classes ?? []).map((c) => [c.id, c]));
  return classes.map((c) => {
    const s = stats.get(c.id);
    return {
      classId: c.id,
      class: className(c),
      subjectTitle: c.subjectTitle,
      schoolYear: c.schoolYear,
      semester: SEMESTERS[c.semester] ?? c.semester,
      state: c.status === 'ACTIVE' ? 'active' : 'archived',
      ...(s ? { students: s.students, dropped: s.dropped, withFinalGrade: s.complete, passed: s.passed, incomplete: s.incomplete, averagePercent: round(s.average), attendanceRate: round(s.attendanceRate) } : {}),
    };
  });
}

/**
 * The instructor's students matching a name or student number. People type names in any order
 * ("Cherie Mae Francisco", "Francisco, Cherie"), so when the whole text finds nobody, the longest
 * word is searched and every word must appear in the student's name or number.
 */
async function findStudents(userId, text) {
  const query = String(text ?? '').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!query) throw new ToolInputError('student must be a name or a student number.');
  const direct = (await listStudents(userId, { search: query, limit: 8 })).items;
  if (direct.length) return direct;
  const words = query.toLowerCase().split(' ').filter((w) => w.length > 1);
  if (words.length < 2) return [];
  const longest = [...words].sort((x, y) => y.length - x.length)[0];
  const { items } = await listStudents(userId, { search: longest, limit: 50 });
  return items.filter((s) => {
    const hay = `${s.firstName} ${s.middleName ?? ''} ${s.lastName} ${s.studentNumber}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }).slice(0, 8);
}

const param = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const CLASS_ID = { type: 'string', description: 'A classId from "Your classes" or from list_classes.' };

const INSTRUCTOR_TOOLS = [
  {
    name: 'get_class_grades',
    description: 'Students\' results in one class for one period (percent, grade, remarks, status), with the class summary. Ask only for what the question needs with "show", "order" and "limit".',
    parameters: param({
      classId: CLASS_ID,
      period: { type: 'string', enum: ['midterm', 'finals', 'overall'], description: 'overall = the Final Grade.' },
      show: { type: 'string', enum: Object.keys(SHOW), description: 'Which students: all, failing (below passing), passing, incomplete (INC), dropped.' },
      order: { type: 'string', enum: Object.keys(ORDER), description: 'name, best grade first, or worst grade first.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'How many students to list (e.g. 5 for a top 5).' },
    }, ['classId', 'period']),
    run: async (user, { classId, period, show = 'all', order = 'name', limit = 40 }) => {
      if (!['midterm', 'finals', 'overall'].includes(period)) throw new ToolInputError('period must be midterm, finals or overall.');
      if (!SHOW[show] || !ORDER[order]) throw new ToolInputError('show or order is not one of the allowed values.');
      const result = await getClassGrades(user.id, needId(classId, 'classId'), period);
      const passing = result.configuration.passingGrade;
      const matching = result.rows.filter((r) => SHOW[show](r, passing)).sort(ORDER[order]);
      const listed = matching.slice(0, Math.min(Math.max(Number(limit) || 40, 1), MAX_ROWS));
      const { distribution, ...summary } = result.summary;
      return {
        class: className(result.class),
        period: result.period,
        passingGrade: passing,
        summary: { ...summary, averagePercentage: round(summary.averagePercentage) },
        distribution: Object.fromEntries(distribution.filter((d) => d.count > 0).map((d) => [d.label, d.count])),
        matching: matching.length,
        columns: GRADE_COLUMNS,
        students: listed.map(gradeLine),
        ...(matching.length > listed.length ? { note: `Listed ${listed.length} of ${matching.length}.` } : {}),
      };
    },
  },
  {
    name: 'get_student_grades',
    description: 'One student\'s grading sheet, found by name or student number: Midterm and Finals by component (score, out of, percent, weighted), the Final Grade, and what is missing. If several students match, it lists them instead.',
    parameters: param({ student: { type: 'string', description: 'A name (or part of one) or a student number.' } }),
    run: async (user, { student }) => {
      const matches = await findStudents(user.id, student);
      if (!matches.length) return { note: 'No student of this instructor matches that.' };
      if (matches.length > 1) {
        return { note: 'More than one student matches. Ask which one, or look up again with the student number.', matches: matches.map((m) => `${m.fullName} | ${m.studentNumber} | ${m.course} ${m.yearLevel}-${m.section}`) };
      }
      const [found] = matches;
      const classes = await getStudentGradesAcrossClasses(user.id, found.id);
      return {
        student: { name: found.fullName, studentNumber: found.studentNumber, course: found.course, yearLevel: found.yearLevel, section: found.section },
        ...(classes.length ? {} : { note: 'This student has no grades in any class yet.' }),
        classes: classes.map((c) => ({
          class: className(c),
          schoolYear: c.schoolYear,
          semester: SEMESTERS[c.semester] ?? c.semester,
          midterm: gradeDetail(c.grades.MIDTERM),
          finals: gradeDetail(c.grades.FINALS),
          finalGrade: gradeDetail(c.grades.OVERALL),
        })),
      };
    },
  },
  {
    name: 'get_class_records',
    description: 'What is recorded in one class: attendance sessions and rate per period, and its quizzes, activities and examinations (title, period, date, max score, Draft/Published).',
    parameters: param({ classId: CLASS_ID }),
    run: async (user, { classId }) => {
      needId(classId, 'classId');
      const [attendance, ...lists] = await Promise.all([
        getAttendanceSummary(user.id, { classId }),
        ...Object.values(ASSESSMENT_TYPES).map((type) => createAssessmentService(type).list(user.id, { classId })),
      ]);
      const [quizzes, activities, examinations] = lists.map((items) => items.slice(0, 60).map((i) => ({ title: i.title, period: i.period, date: i.date, maxScore: i.maxScore, state: i.status, ...(typeof i.stats?.average === 'number' ? { classAverage: round(i.stats.average) } : {}) })));
      return {
        attendance: (attendance.periods ?? []).map((p) => ({ period: p.period, sessions: p.sessions, present: p.present, absent: p.absent, excused: p.excused, attendanceRate: round(p.attendanceRate) })),
        writtenQuizzes: quizzes,
        performanceActivities: activities,
        examinations,
      };
    },
  },
  {
    name: 'get_class_attendance',
    description: 'Each student\'s attendance in one class: present, absent, excused, rate, per period.',
    parameters: param({ classId: CLASS_ID }),
    run: async (user, { classId }) => {
      const { students = [] } = await getAttendanceSummary(user.id, { classId: needId(classId, 'classId') });
      return {
        columns: 'name | student number | period | present | absent | excused | sessions | rate %',
        students: students.slice(0, MAX_ROWS * 2).map((r) => [r.fullName, r.studentNumber, r.period, r.present, r.absent, r.excused, r.total, round(r.attendanceRate)].join(' | ')),
      };
    },
  },
];

const ADMIN_TOOLS = [
  {
    name: 'list_instructor_accounts',
    description: 'The instructor accounts: name, whether the account is active or disabled, number of active classes, and last sign-in date.',
    parameters: param({}),
    run: async () => (await listAccounts())
      .filter((a) => a.role === ROLES.INSTRUCTOR)
      .map((a) => ({ name: a.name, state: a.status === 'ACTIVE' ? 'active' : 'disabled', activeClasses: a.activeClasses, lastSignIn: a.lastLoginAt ? new Date(a.lastLoginAt).toISOString().slice(0, 10) : 'never' })),
  },
];

/** How Gradify works, read one or two topics at a time (both roles). */
const GUIDE_TOOL = {
  name: 'read_guide',
  description: `How Gradify works. Read the topic(s) a how-to or grading-rule question needs before answering it. Topics: ${Object.entries(GUIDE_TOPICS).map(([key, about]) => `${key} (${about})`).join('; ')}.`,
  parameters: param({ topics: { type: 'array', items: { type: 'string', enum: Object.keys(GUIDE_TOPICS) }, minItems: 1, maxItems: 3 } }),
  run: async (user, { topics }) => {
    const wanted = (Array.isArray(topics) ? topics : [topics]).filter((t) => Object.hasOwn(GUIDE_TOPICS, t)).slice(0, 3);
    if (!wanted.length) throw new ToolInputError(`topics must be from: ${Object.keys(GUIDE_TOPICS).join(', ')}.`);
    return wanted.map((t) => GUIDE[t]).join('\n\n');
  },
};

const toolsFor = (role) => [GUIDE_TOOL, ...(role === ROLES.ADMIN ? ADMIN_TOOLS : INSTRUCTOR_TOOLS)];

/** The lookups offered to the model for this role, in the AI service's format. */
export const toolDefinitions = (role) => toolsFor(role).map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));

/**
 * Runs one lookup for the signed-in user and returns its result as text for the model.
 * Never throws: a failed lookup is reported to the model in plain words so it can say so.
 */
export async function runTool(user, name, rawArguments) {
  const tool = toolsFor(user.role).find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: 'There is no such lookup.' });
  try {
    const args = typeof rawArguments === 'string' && rawArguments.trim() ? JSON.parse(rawArguments) : {};
    const result = await tool.run(user, args && typeof args === 'object' ? args : {});
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (error) {
    if (error instanceof ToolInputError || error instanceof SyntaxError) return JSON.stringify({ error: error instanceof SyntaxError ? 'The request was not understood.' : error.message });
    // Not found, not allowed, or anything unexpected: the model only learns that it has no result.
    if (error.statusCode && error.statusCode < 500) return JSON.stringify({ error: 'Nothing was found for that. It may not exist or may not be one of this person\'s records.' });
    throw error;
  }
}
