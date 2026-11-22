/**
 * Grading engine orchestration — the single source of truth for official grades.
 * Retrieves sources (repository), applies the official formulas (calculator), and persists
 * results (computedGrades) with revision-based consistency. Independent of Express and React.
 */
import mongoose from 'mongoose';
import { logger } from '../../config/logger.js';
import { ComputedGrade, CALC_STATUSES } from '../../models/ComputedGrade.js';
import { Class } from '../../models/Class.js';
import { formatFullName } from '../../models/Student.js';
import { ApiError } from '../../utils/ApiError.js';
import { afterCommit } from '../../utils/transaction.js';
import { recordAudit } from '../audit.service.js';
import { getOwnedClass } from '../class.service.js';
import { onSourceChanged } from './grading.events.js';
import { computePeriod, computeOverall, COMPLETION_STATUS, CALCULATION_VERSION, incDeadline, remarksForGrade } from './grading.calculator.js';
import { getActiveConfiguration, createVersion, listVersions, toPublicConfiguration } from './grading.config.service.js';
import * as repo from './grading.repository.js';

const PERIODS = ['MIDTERM', 'FINALS'];
const MAX_ATTEMPTS = 4;

/* ───────────────────────── Recalculation ───────────────────────── */

function periodFields(result, config) {
  return {
    configuration: config._id,
    configVersion: config.version,
    calculationVersion: CALCULATION_VERSION,
    components: result.components.map((c) => ({
      key: c.key, label: c.label, weight: c.weight, itemCount: c.itemCount, scoredCount: c.scoredCount,
      rawScore: c.rawScore, maxScore: c.maxScore, present: c.present, absent: c.absent, excused: c.excused,
      percentage: c.percentage, weightedContribution: c.weightedContribution, empty: c.empty,
    })),
    periodResults: null,
    missingItems: result.missingItems,
    emptyComponents: result.emptyComponents,
    percentage: result.percentage,
    roundedPercent: result.roundedPercent,
    grade: result.grade,
    remarks: result.remarks,
    completionStatus: result.status,
    incDeadline: null,
  };
}

/**
 * Recalculates every grade (Midterm, Finals, Overall) of the given students in one class.
 * Revisions are read BEFORE the sources, and each result is stored only if its revision is
 * unchanged — otherwise a newer change arrived and that student is recalculated again.
 */
export async function recalculateStudents(classId, studentIds, { reason = 'RECALCULATE', userId } = {}) {
  const cls = await repo.getClass(classId);
  if (!cls || studentIds.length === 0) return { recalculated: 0 };
  const config = await getActiveConfiguration();
  const enrolled = new Map((await repo.findGradedStudents(classId)).map((s) => [s.studentId, s]));
  let pending = [...new Set(studentIds.map(String))].filter((id) => enrolled.has(id));
  const lapsedNow = [];
  let done = 0;

  try {
    for (let attempt = 1; pending.length && attempt <= MAX_ATTEMPTS; attempt += 1) {
      const existing = await repo.findComputed(classId, pending);
      const revisionOf = new Map(existing.map((d) => [`${d.student}|${d.period}`, d.sourceRevision ?? 0]));
      const existingOverall = new Map(existing.filter((d) => d.period === 'OVERALL').map((d) => [d.student.toString(), d]));

      const inputsByPeriod = {};
      for (const period of PERIODS) inputsByPeriod[period] = await repo.loadPeriodInputs(cls, period, pending, config.periods[period]);

      const conflicted = [];
      for (const studentId of pending) {
        const dropped = enrolled.get(studentId).dropped;
        const results = {};
        let ok = true;
        for (const period of PERIODS) {
          results[period] = computePeriod({ configuration: config, period, inputs: inputsByPeriod[period].get(studentId), dropped });
          ok = (await repo.saveResultIfCurrent(cls, studentId, period, revisionOf.get(`${studentId}|${period}`) ?? 0, periodFields(results[period], config))) && ok;
        }

        const previousOverall = existingOverall.get(studentId);
        let overall;
        let lapsedAt = previousOverall?.lapsedAt ?? null;
        if (lapsedAt && !dropped) {
          // A lapsed INC is final (Handbook §55.1): later score entries never change it. The result is
          // rebuilt from the lapse rule — never copied from the previous record, which may hold a DRP state.
          const lapseGrade = config.incompleteRule.lapseGrade;
          overall = {
            status: COMPLETION_STATUS.INC_LAPSED,
            grade: lapseGrade,
            remarks: `${remarksForGrade(lapseGrade, config.gradeConversion.remarks) ?? 'Failure'} (INC lapsed)`,
            percentage: null,
            roundedPercent: null,
            missingItems: previousOverall.missingItems ?? [],
            incDeadline: previousOverall.incDeadline,
          };
        } else {
          overall = computeOverall({ configuration: config, periods: results, dropped, termEndDate: cls.termEndDate });
          if (overall.status === COMPLETION_STATUS.INC_LAPSED) {
            lapsedAt = new Date();
            lapsedNow.push(studentId);
          }
        }
        ok = (await repo.saveResultIfCurrent(cls, studentId, 'OVERALL', revisionOf.get(`${studentId}|OVERALL`) ?? 0, {
          configuration: config._id,
          configVersion: config.version,
          calculationVersion: CALCULATION_VERSION,
          components: [],
          periodResults: Object.fromEntries(PERIODS.map((p) => [p, {
            status: results[p].status,
            percentage: results[p].percentage,
            grade: results[p].grade,
            weight: config.periodWeights[p],
            weightedContribution: results[p].percentage === null ? null : (results[p].percentage * config.periodWeights[p]) / 100,
          }])),
          missingItems: overall.missingItems ?? [],
          emptyComponents: [],
          percentage: overall.percentage,
          roundedPercent: overall.roundedPercent,
          grade: overall.grade,
          remarks: overall.remarks,
          completionStatus: overall.status,
          incDeadline: overall.incDeadline ?? incDeadline(cls.termEndDate, config.incompleteRule),
          lapsedAt,
        })) && ok;

        if (ok) done += 1;
        else conflicted.push(studentId);
      }
      pending = conflicted;
    }
    if (pending.length) throw new Error(`Grades kept changing during recalculation (${pending.length} student(s)); will retry.`);
  } catch (error) {
    logger.error(`Grade recalculation failed for class ${classId}:`, error.message);
    await repo.markFailed(classId, pending.length ? pending : studentIds.map(String), error.message);
    await recordAudit({ userId, action: 'GRADE_RECALCULATE_FAILED', collection: 'computedGrades', classId, metadata: { reason, students: studentIds.length, error: error.message } });
    return { recalculated: done, failed: pending.length || studentIds.length };
  }

  await recordAudit({ userId, action: 'GRADE_RECALCULATE', collection: 'computedGrades', classId, metadata: { reason, students: done, configVersion: config.version } });
  for (const studentId of lapsedNow) {
    await recordAudit({ userId, action: 'GRADE_INC_LAPSED', collection: 'computedGrades', classId, metadata: { studentId, grade: config.incompleteRule.lapseGrade } });
  }
  return { recalculated: done, failed: 0 };
}

/**
 * Source-change handler: mark stale inside the source transaction, then recalculate after it
 * commits. If recalculation fails, the last result is kept and flagged FAILED — never shown as current.
 */
async function handleSourceChange(change, { session } = {}) {
  const studentIds = (change.studentIds ?? []).map(String);
  if (!studentIds.length) return;
  await repo.markStale({ classId: change.classId, periods: change.periods, studentIds }, { session });
  await afterCommit(session, () => recalculateStudents(change.classId, studentIds, { reason: change.reason, userId: change.userId }));
}

onSourceChanged(handleSourceChange);

/** Students whose stored grades are missing, stale, failed, from an older configuration, or past an INC deadline. */
async function findStudentsNeedingWork(cls, config) {
  const graded = await repo.findGradedStudents(cls._id);
  const docs = await ComputedGrade.find({ class: cls._id }).lean();
  const byStudent = new Map();
  for (const d of docs) {
    if (!byStudent.has(d.student.toString())) byStudent.set(d.student.toString(), []);
    byStudent.get(d.student.toString()).push(d);
  }
  const now = new Date();
  return graded
    .filter(({ studentId }) => {
      const list = byStudent.get(studentId) ?? [];
      if (list.length < 3) return true;
      return list.some(
        (d) =>
          d.calcStatus !== CALC_STATUSES.CURRENT ||
          d.calculatedRevision !== d.sourceRevision ||
          d.configVersion !== config.version ||
          (d.period === 'OVERALL' && d.completionStatus === COMPLETION_STATUS.INCOMPLETE && d.incDeadline && d.incDeadline < now),
      );
    })
    .map((s) => s.studentId);
}

/** Recalculates whatever is not current before grades are presented (reliable reads). */
export async function ensureCurrent(classId) {
  const cls = await repo.getClass(classId);
  if (!cls) return;
  // Remove derived grades of students no longer enrolled (e.g. written by a recalculation that
  // was already running when a mistaken enrollment was removed).
  const enrolledIds = (await repo.findGradedStudents(classId)).map((s) => new mongoose.Types.ObjectId(s.studentId));
  await ComputedGrade.deleteMany({ class: cls._id, student: { $nin: enrolledIds } });
  const config = await getActiveConfiguration();
  const ids = await findStudentsNeedingWork(cls, config);
  if (ids.length) await recalculateStudents(classId, ids, { reason: 'ENSURE_CURRENT' });
}

/** Periodic safety net: retries failed/stale grades and applies INC lapses. */
export async function sweep() {
  const now = new Date();
  const classIds = await ComputedGrade.distinct('class', {
    $or: [{ calcStatus: { $ne: CALC_STATUSES.CURRENT } }, { period: 'OVERALL', completionStatus: COMPLETION_STATUS.INCOMPLETE, incDeadline: { $lt: now } }],
  });
  for (const classId of classIds) {
    try {
      await ensureCurrent(classId);
    } catch (error) {
      logger.error(`Grade sweep failed for class ${classId}:`, error.message);
    }
  }
  return { classes: classIds.length };
}

/** Marks all students of a class stale and recalculates (manual "Recalculate" and config changes). */
export async function recalculateClass(classId, { reason, userId } = {}) {
  const ids = (await repo.findGradedStudents(classId)).map((s) => s.studentId);
  await repo.markStale({ classId, periods: PERIODS, studentIds: ids });
  return recalculateStudents(classId, ids, { reason, userId });
}

/* ───────────────────────── Reads (presentation data) ───────────────────────── */

function isCurrent(doc) {
  return doc.calcStatus === CALC_STATUSES.CURRENT && doc.calculatedRevision === doc.sourceRevision;
}

/** A grade that is not current is never presented as current: its values move to lastKnown. */
function toPublicGrade(doc, student) {
  const current = isCurrent(doc);
  const values = {
    percentage: doc.percentage,
    roundedPercent: doc.roundedPercent,
    grade: doc.grade,
    remarks: doc.remarks,
    completionStatus: doc.completionStatus,
  };
  return {
    studentId: doc.student.toString(),
    studentNumber: student?.studentNumber ?? null,
    fullName: student ? formatFullName(student) : 'Unknown student',
    period: doc.period,
    current,
    calcStatus: current ? CALC_STATUSES.CURRENT : doc.calcStatus === CALC_STATUSES.FAILED ? CALC_STATUSES.FAILED : CALC_STATUSES.STALE,
    ...(current ? values : { percentage: null, roundedPercent: null, grade: null, remarks: null, completionStatus: null, lastKnown: values }),
    components: doc.components ?? [],
    periodResults: doc.periodResults ?? null,
    missingItems: doc.missingItems ?? [],
    emptyComponents: doc.emptyComponents ?? [],
    incDeadline: doc.incDeadline ?? null,
    lapsedAt: doc.lapsedAt ?? null,
    configVersion: doc.configVersion,
    lastCalculatedAt: doc.lastCalculatedAt,
  };
}

export function summarize(rows) {
  const current = rows.filter((r) => r.current);
  const complete = current.filter((r) => r.completionStatus === COMPLETION_STATUS.COMPLETE);
  const count = (status) => current.filter((r) => r.completionStatus === status).length;
  const grades = complete.map((r) => r.grade);
  const bands = [
    { label: '1.0–1.4', min: 1.0, max: 1.4 }, { label: '1.5–1.9', min: 1.5, max: 1.9 }, { label: '2.0–2.4', min: 2.0, max: 2.4 },
    { label: '2.5–2.9', min: 2.5, max: 2.9 }, { label: '3.0', min: 3.0, max: 3.0 }, { label: '3.1–4.0', min: 3.1, max: 4.0 }, { label: '4.1–5.0', min: 4.1, max: 5.0 },
  ];
  return {
    totalStudents: rows.length,
    complete: complete.length,
    incomplete: count(COMPLETION_STATUS.INCOMPLETE),
    notComputable: count(COMPLETION_STATUS.NOT_COMPUTABLE),
    dropped: count(COMPLETION_STATUS.DROPPED),
    lapsed: count(COMPLETION_STATUS.INC_LAPSED),
    pending: rows.length - current.length,
    // Average of the students' computed percentages (descriptive statistic, not a grade).
    averagePercentage: complete.length ? complete.reduce((s, r) => s + r.percentage, 0) / complete.length : null,
    highestGrade: grades.length ? Math.min(...grades) : null, // 1.0 is the best grade
    lowestGrade: grades.length ? Math.max(...grades) : null,
    passed: complete.filter((r) => r.grade <= 3.0).length,
    distribution: [
      ...bands.map((b) => ({ label: b.label, count: grades.filter((g) => g >= b.min - 1e-9 && g <= b.max + 1e-9).length })),
      { label: 'INC', count: count(COMPLETION_STATUS.INCOMPLETE) },
      { label: 'DRP', count: count(COMPLETION_STATUS.DROPPED) },
    ],
  };
}

function publicConfigSummary(config) {
  return {
    version: config.version,
    periodWeights: config.periodWeights,
    periods: Object.fromEntries(PERIODS.map((p) => [p, { label: config.periods[p].label, components: config.periods[p].components.map(({ key, label, weight }) => ({ key, label, weight })) }])),
    passingGrade: config.gradeConversion.passingGrade,
  };
}

const PERIOD_PARAM = { midterm: 'MIDTERM', finals: 'FINALS', overall: 'OVERALL' };
export function parsePeriodParam(value) {
  const period = PERIOD_PARAM[String(value).toLowerCase()];
  if (!period) throw ApiError.badRequest('Grading period must be midterm, finals, or overall');
  return period;
}

async function loadRows(cls, period, { studentId } = {}) {
  await ensureCurrent(cls._id);
  const filter = { class: cls._id, schoolYear: cls.schoolYear, semester: cls.semester, period };
  if (studentId) filter.student = new mongoose.Types.ObjectId(studentId);
  const graded = new Set((await repo.findGradedStudents(cls._id)).map((s) => s.studentId));
  const docs = (await ComputedGrade.find(filter).lean()).filter((d) => graded.has(d.student.toString()));
  const students = await repo.studentsByIds(docs.map((d) => d.student));
  const byId = new Map(students.map((s) => [s._id.toString(), s]));
  return docs
    .map((d) => ({ ...toPublicGrade(d, byId.get(d.student.toString())), archived: Boolean(byId.get(d.student.toString())?.archivedAt) }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Class grading sheet for one period (midterm / finals / overall). */
export async function getClassGrades(instructorId, classId, periodParam) {
  const period = parsePeriodParam(periodParam);
  const cls = await getOwnedClass(instructorId, classId);
  const config = await getActiveConfiguration();
  const rows = await loadRows(cls.toObject(), period);
  return { period, class: { id: cls._id.toString(), subjectCode: cls.subjectCode, section: cls.section, schoolYear: cls.schoolYear, semester: cls.semester }, configuration: publicConfigSummary(config), summary: summarize(rows), rows };
}

export async function getClassSummary(instructorId, classId, periodParam) {
  const { period, summary } = await getClassGrades(instructorId, classId, periodParam);
  return { period, summary };
}

/** One student's full breakdown for a period (with the Midterm/Finals details for Overall). */
export async function getStudentGrade(instructorId, classId, periodParam, studentId) {
  const period = parsePeriodParam(periodParam);
  if (!mongoose.isValidObjectId(studentId)) throw ApiError.notFound('Student grade not found');
  const cls = await getOwnedClass(instructorId, classId);
  const config = await getActiveConfiguration();
  const [row] = await loadRows(cls.toObject(), period, { studentId });
  if (!row) throw ApiError.notFound('This student has no grade in this class');
  const [student] = await repo.studentsByIds([studentId]);
  const detail = { ...row, student: { id: student._id.toString(), studentNumber: student.studentNumber, fullName: formatFullName(student), course: student.course, yearLevel: student.yearLevel, section: student.section } };
  if (period === 'OVERALL') {
    detail.periods = {};
    for (const p of PERIODS) [detail.periods[p]] = await loadRows(cls.toObject(), p, { studentId });
  }
  return { period, class: { id: cls._id.toString(), subjectCode: cls.subjectCode, subjectTitle: cls.subjectTitle, section: cls.section, schoolYear: cls.schoolYear, semester: cls.semester }, configuration: publicConfigSummary(config), grade: detail };
}

/** All of a student's grades across the instructor's classes (student detail page). */
export async function getStudentGradesAcrossClasses(instructorId, studentId) {
  const classes = await Class.find({ instructor: instructorId }).lean();
  const results = [];
  for (const cls of classes) {
    const graded = (await repo.findGradedStudents(cls._id)).some((s) => s.studentId === String(studentId));
    if (!graded) continue;
    await ensureCurrent(cls._id);
    const docs = await ComputedGrade.find({ class: cls._id, student: studentId }).lean();
    results.push({
      classId: cls._id.toString(),
      subjectCode: cls.subjectCode,
      section: cls.section,
      schoolYear: cls.schoolYear,
      semester: cls.semester,
      grades: Object.fromEntries(docs.map((d) => [d.period, toPublicGrade(d)])),
    });
  }
  return results;
}

export async function requestRecalculation(instructorId, classId, req) {
  await getOwnedClass(instructorId, classId);
  const result = await recalculateClass(classId, { reason: 'MANUAL', userId: instructorId });
  await recordAudit({ userId: instructorId, action: 'GRADE_RECALCULATE_REQUEST', collection: 'computedGrades', classId, metadata: result, req });
  return result;
}

/* ───────────────────────── Configuration ───────────────────────── */

export async function getConfiguration() {
  return toPublicConfiguration(await getActiveConfiguration());
}

export async function getConfigurationVersions() {
  return listVersions();
}

/**
 * The administrator publishes a new configuration version for everyone (D21). Every stored grade
 * is marked stale in one update; each class recalculates the next time its grades are read, and
 * the scheduled sweep catches the rest. (Recalculating every class inside this one request would
 * not scale on serverless hosting.)
 */
export async function updateConfiguration(adminId, changes, req) {
  const { current } = await createVersion(adminId, changes, req);
  const classes = await ComputedGrade.distinct('class');
  const stale = await ComputedGrade.updateMany({}, { $inc: { sourceRevision: 1 }, $set: { calcStatus: CALC_STATUSES.STALE } });
  return { configuration: toPublicConfiguration(current), classesToRecalculate: classes.length, gradeRecordsMarked: stale.modifiedCount };
}
