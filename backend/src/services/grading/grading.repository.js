/**
 * Data access for the grading engine: reads source records, reads/writes computed grades.
 * No formulas live here.
 */
import mongoose from 'mongoose';
import { ComputedGrade, CALC_STATUSES } from '../../models/ComputedGrade.js';
import { Class } from '../../models/Class.js';
import { Enrollment } from '../../models/Enrollment.js';
import { Student } from '../../models/Student.js';
import { AttendanceRecord } from '../../models/AttendanceRecord.js';
import { ASSESSMENT_TYPES, ASSESSMENT_STATUSES } from '../../models/assessments.js';
import { COMPONENT_SOURCES } from './grading.defaults.js';

const { ObjectId } = mongoose.Types;
const toId = (id) => (id instanceof ObjectId ? id : new ObjectId(String(id)));
const SOURCE_TO_TYPE = Object.fromEntries(Object.values(ASSESSMENT_TYPES).map((t) => [t.componentSource, t]));

export const keyFor = (cls, studentId, period) => ({
  student: toId(studentId),
  class: cls._id,
  schoolYear: cls.schoolYear,
  semester: cls.semester,
  period,
});

export function getClass(classId, { session } = {}) {
  return Class.findById(classId).session(session ?? null).lean();
}

/** Students that have computed grades in a class: every enrollment, enrolled or dropped. */
export async function findGradedStudents(classId) {
  const enrollments = await Enrollment.find({ class: classId }).lean();
  return enrollments.map((e) => ({ studentId: e.student.toString(), dropped: e.status === 'DROPPED' }));
}

/**
 * Marks the given students' grades for `periods` and OVERALL as stale and bumps their revision.
 * Called inside the source change's transaction, so it commits (or rolls back) with it.
 */
export async function markStale({ classId, periods, studentIds }, { session } = {}) {
  if (!studentIds?.length) return;
  const cls = await getClass(classId, { session });
  if (!cls) return;
  const targets = [...new Set([...(periods ?? []), 'OVERALL'])];
  const ops = [];
  for (const studentId of studentIds) {
    for (const period of targets) {
      ops.push({
        updateOne: {
          filter: keyFor(cls, studentId, period),
          update: { $inc: { sourceRevision: 1 }, $set: { calcStatus: CALC_STATUSES.STALE } },
          upsert: true,
        },
      });
    }
  }
  await ComputedGrade.bulkWrite(ops, { session, ordered: false });
}

export function findComputed(classId, studentIds) {
  return ComputedGrade.find({ class: classId, student: { $in: studentIds.map(toId) } }).lean();
}

/**
 * Stores a result only if nothing changed since `revision` was read.
 * Returns false on a conflict (a newer change arrived; the caller recalculates again).
 */
export async function saveResultIfCurrent(cls, studentId, period, revision, fields) {
  try {
    const res = await ComputedGrade.updateOne(
      { ...keyFor(cls, studentId, period), sourceRevision: revision },
      {
        $set: { ...fields, calcStatus: CALC_STATUSES.CURRENT, calculatedRevision: revision, lastCalculatedAt: new Date(), lastError: null },
      },
      { upsert: true },
    );
    return res.matchedCount === 1 || res.upsertedCount === 1;
  } catch (error) {
    if (error?.code === 11000) return false; // document appeared with a different revision
    throw error;
  }
}

export async function markFailed(classId, studentIds, message) {
  await ComputedGrade.updateMany(
    { class: classId, student: { $in: studentIds.map(toId) }, calcStatus: { $ne: CALC_STATUSES.CURRENT } },
    { $set: { calcStatus: CALC_STATUSES.FAILED, lastError: String(message).slice(0, 500) } },
  );
}

/**
 * Loads every source a period grade depends on, for many students at once.
 * Returns Map(studentId → { [componentKey]: input }) following the configuration's components.
 */
export async function loadPeriodInputs(cls, period, studentIds, periodConfig) {
  const ids = studentIds.map(toId);
  const inputs = new Map(studentIds.map((id) => [String(id), {}]));

  for (const component of periodConfig.components) {
    if (component.source === COMPONENT_SOURCES.ATTENDANCE) {
      const rows = await AttendanceRecord.aggregate([
        { $match: { class: cls._id, period, student: { $in: ids } } },
        { $group: { _id: { student: '$student', status: '$status' }, n: { $sum: 1 } } },
      ]);
      for (const id of studentIds) inputs.get(String(id))[component.key] = { present: 0, absent: 0, excused: 0, total: 0 };
      for (const { _id, n } of rows) {
        const entry = inputs.get(_id.student.toString())[component.key];
        entry[_id.status.toLowerCase()] += n;
        entry.total += n;
      }
      continue;
    }

    const type = SOURCE_TO_TYPE[component.source];
    if (!type) throw new Error(`Unknown component source ${component.source}`);
    const items = await type.Assessment.find({ class: cls._id, period, status: ASSESSMENT_STATUSES.PUBLISHED, deletedAt: null })
      .sort({ date: 1, createdAt: 1 })
      .lean();
    const scores = await type.Score.find({ [type.refField]: { $in: items.map((i) => i._id) }, student: { $in: ids } }).lean();
    const scoreMap = new Map(scores.map((s) => [`${s[type.refField]}|${s.student}`, s.score]));
    for (const id of studentIds) {
      inputs.get(String(id))[component.key] = items.map((item) => ({
        id: item._id.toString(),
        title: item.title,
        maxScore: item.maxScore,
        score: scoreMap.has(`${item._id}|${id}`) ? scoreMap.get(`${item._id}|${id}`) : null,
      }));
    }
  }
  return inputs;
}

export async function findLapsedStudentIds(classId, studentIds) {
  const docs = await ComputedGrade.find({ class: classId, period: 'OVERALL', lapsedAt: { $ne: null }, student: { $in: studentIds.map(toId) } })
    .select('student')
    .lean();
  return docs.map((d) => d.student.toString());
}

export async function deleteComputedFor(classId, studentId, { session } = {}) {
  await ComputedGrade.deleteMany({ class: classId, student: toId(studentId) }, { session });
}

export function studentsByIds(ids) {
  return Student.find({ _id: { $in: ids.map(toId) } }).lean();
}
