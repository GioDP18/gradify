import mongoose from 'mongoose';
import { ASSESSMENT_STATUSES } from '../models/assessments.js';
import { Student, formatFullName } from '../models/Student.js';
import { Enrollment } from '../models/Enrollment.js';
import { CLASS_STATUSES } from '../models/Class.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { parseDateOnly, formatDateOnly } from '../utils/dates.js';
import { escapeRegex } from '../utils/strings.js';
import { recordAudit } from './audit.service.js';
import { getOwnedClass } from './class.service.js';
import { findRequiredStudentIds, findAllEnrolledStudentIds } from './enrollment.service.js';
import { assessmentStatistics } from './assessmentStats.js';
import { notifySourceChanged } from './grading/grading.events.js';
import { decimalPlaces } from './grading/grading.utils.js';
import { findLapsedStudentIds } from './grading/grading.repository.js';

const { ObjectId } = mongoose.Types;
const AUDITED = ['title', 'description', 'instructions', 'period', 'date', 'maxScore', 'status'];

/**
 * Builds the service for one assessment type (quizzes, activities, examinations).
 * All three share these rules; each keeps its own collections.
 */
export function createAssessmentService(type) {
  const { Assessment, Score, refField, singular, auditPrefix, collection } = type;
  const notFound = () => ApiError.notFound(`${singular} not found`);

  const snapshot = (doc) => Object.fromEntries(AUDITED.map((f) => [f, f === 'date' ? formatDateOnly(doc.date) : doc[f] ?? null]));

  function toPublic(doc, stats) {
    return {
      id: doc._id.toString(),
      classId: doc.class.toString(),
      title: doc.title,
      description: doc.description ?? null,
      instructions: doc.instructions ?? null,
      period: doc.period,
      date: formatDateOnly(doc.date),
      maxScore: doc.maxScore,
      status: doc.status,
      revision: doc.revision ?? 0,
      deletedAt: doc.deletedAt ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      ...(stats ? { stats } : {}),
    };
  }

  async function getOwned(instructorId, id, { allowDeleted = false } = {}) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const doc = await Assessment.findById(id);
    if (!doc || (doc.deletedAt && !allowDeleted)) throw notFound();
    const cls = await getOwnedClass(instructorId, doc.class).catch(() => {
      throw notFound();
    });
    return { doc, cls };
  }

  const assertActive = (cls) => {
    if (cls.status !== CLASS_STATUSES.ACTIVE) throw ApiError.conflict('This class is archived. Restore it to make changes.');
  };

  async function notifyAll(doc, reason, instructorId, session, periods = [doc.period]) {
    const studentIds = await findAllEnrolledStudentIds(doc.class, { session });
    await notifySourceChanged({ classId: doc.class, periods: [...new Set(periods)], studentIds, reason, userId: instructorId }, { session });
  }

  function validateDate(value) {
    const date = parseDateOnly(value);
    if (!date) throw ApiError.validation([{ field: 'date', message: 'Date must be a valid date (YYYY-MM-DD)' }]);
    return date;
  }

  async function statsFor(docs, classId) {
    const rosterIds = (await findRequiredStudentIds(classId)).map(String);
    const roster = new Set(rosterIds);
    const scores = await Score.find({ [refField]: { $in: docs.map((d) => d._id) } }).lean();
    const byItem = new Map();
    for (const s of scores) {
      if (!roster.has(s.student.toString())) continue;
      const key = s[refField].toString();
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(s.score);
    }
    return new Map(docs.map((d) => [d._id.toString(), assessmentStatistics(byItem.get(d._id.toString()) ?? [], d.maxScore, roster.size)]));
  }

  async function list(instructorId, { classId, period, status, search }) {
    await getOwnedClass(instructorId, classId);
    const filter = { class: classId, deletedAt: null };
    if (period) filter.period = period;
    if (status) filter.status = status;
    if (search?.trim()) filter.title = new RegExp(escapeRegex(search.trim()), 'i');
    const docs = await Assessment.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    const stats = await statsFor(docs, classId);
    return docs.map((d) => {
      const { distribution, ...summary } = stats.get(d._id.toString());
      return toPublic(d, summary);
    });
  }

  async function get(instructorId, id) {
    const { doc } = await getOwned(instructorId, id);
    const stats = await statsFor([doc], doc.class);
    return toPublic(doc, stats.get(doc._id.toString()));
  }

  async function create(instructorId, data, req) {
    const cls = await getOwnedClass(instructorId, data.classId);
    assertActive(cls);
    const date = validateDate(data.date);
    return runInTransaction(async (session) => {
      const [doc] = await Assessment.create(
        [{
          class: cls._id,
          title: data.title,
          description: data.description || null,
          instructions: data.instructions || null,
          period: data.period,
          date,
          maxScore: data.maxScore,
          status: data.status ?? ASSESSMENT_STATUSES.PUBLISHED,
          createdBy: instructorId,
        }],
        { session },
      );
      await recordAudit({ userId: instructorId, action: `${auditPrefix}_CREATE`, collection, recordId: doc._id, classId: cls._id, newValue: snapshot(doc), req }, { session });
      // A new published item becomes a requirement for every enrolled student.
      if (doc.status === ASSESSMENT_STATUSES.PUBLISHED) await notifyAll(doc, `${auditPrefix}_CREATE`, instructorId, session);
      return toPublic(doc, assessmentStatistics([], doc.maxScore, 0));
    });
  }

  async function update(instructorId, id, data, req) {
    const { doc, cls } = await getOwned(instructorId, id);
    assertActive(cls);
    const before = snapshot(doc);
    const previousPeriod = doc.period;
    const readRevision = doc.revision ?? 0;

    // Rule checks run inside the transaction (below) so they cannot race with score saves.
    async function assertRules(session) {
      if (data.period !== undefined && data.period !== previousPeriod && (await Score.exists({ [refField]: doc._id }).session(session ?? null))) {
        throw ApiError.conflict('The grading period cannot be changed after scores have been entered.');
      }
      if (data.maxScore !== undefined && data.maxScore < before.maxScore) {
        const above = await Score.findOne({ [refField]: doc._id, score: { $gt: data.maxScore } }).sort({ score: -1 }).session(session ?? null).lean();
        if (above) {
          throw ApiError.conflict(`Maximum score cannot be lower than an existing score (${above.score}). Correct those scores first.`);
        }
      }
    }

    for (const field of ['title', 'description', 'instructions', 'period', 'maxScore', 'status']) {
      if (data[field] !== undefined) doc[field] = field === 'description' || field === 'instructions' ? data[field] || null : data[field];
    }
    if (data.date !== undefined) doc.date = validateDate(data.date);
    if (!doc.isModified()) {
      await assertRules(null);
      return get(instructorId, id);
    }

    const affectsGrades = ['period', 'maxScore', 'status'].some((f) => doc.isModified(f));
    await runInTransaction(async (session) => {
      // Claim the same revision counter score saves use: edits and score saves are serialized,
      // so a score can never be saved against a period or maximum that changed underneath it.
      const claimed = await Assessment.findOneAndUpdate({ _id: doc._id, revision: readRevision, deletedAt: null }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
      if (!claimed) throw new ApiError(409, 'STALE_REVISION', `This ${singular.toLowerCase()} was changed elsewhere at the same moment. Reload and try again.`);
      await assertRules(session);
      doc.revision = claimed.revision;
      await doc.save({ session });
      await recordAudit(
        { userId: instructorId, action: `${auditPrefix}_UPDATE`, collection, recordId: doc._id, classId: doc.class, previousValue: before, newValue: snapshot(doc), req },
        { session },
      );
      if (affectsGrades) await notifyAll(doc, `${auditPrefix}_UPDATE`, instructorId, session, [previousPeriod, doc.period]);
    });
    return get(instructorId, id);
  }

  /** Soft delete: the item stops counting toward grades; its scores are kept for history. */
  async function remove(instructorId, id, req) {
    const { doc, cls } = await getOwned(instructorId, id);
    assertActive(cls);
    const scoreCount = await Score.countDocuments({ [refField]: doc._id });
    await runInTransaction(async (session) => {
      doc.deletedAt = new Date();
      doc.deletedBy = instructorId;
      await doc.save({ session });
      await recordAudit(
        { userId: instructorId, action: `${auditPrefix}_DELETE`, collection, recordId: doc._id, classId: doc.class, previousValue: snapshot(doc), metadata: { preservedScores: scoreCount }, req },
        { session },
      );
      if (doc.status === ASSESSMENT_STATUSES.PUBLISHED) await notifyAll(doc, `${auditPrefix}_DELETE`, instructorId, session);
    });
  }

  /**
   * Score sheet: every currently enrolled student (required to have a score) plus anyone who
   * already has a score (e.g. later dropped or archived), with the class statistics.
   */
  async function getScoreSheet(instructorId, id) {
    const { doc } = await getOwned(instructorId, id);
    const rosterIds = (await findRequiredStudentIds(doc.class)).map(String);
    const scores = await Score.find({ [refField]: doc._id }).lean();
    const scoreByStudent = new Map(scores.map((s) => [s.student.toString(), s]));
    const studentIds = [...new Set([...rosterIds, ...scoreByStudent.keys()])];
    const [students, enrollments] = await Promise.all([
      Student.find({ _id: { $in: studentIds } }).lean(),
      Enrollment.find({ class: doc.class, student: { $in: studentIds } }).lean(),
    ]);
    const roster = new Set(rosterIds);
    const enrollmentByStudent = new Map(enrollments.map((e) => [e.student.toString(), e.status]));

    const rows = students
      .map((s) => {
        const id = s._id.toString();
        const score = scoreByStudent.get(id);
        return {
          studentId: id,
          studentNumber: s.studentNumber,
          fullName: formatFullName(s),
          score: score ? score.score : null,
          itemPercent: score ? (score.score / doc.maxScore) * 100 : null,
          required: roster.has(id),
          enrollmentStatus: enrollmentByStudent.get(id) ?? null,
          archived: Boolean(s.archivedAt),
          updatedAt: score?.updatedAt ?? null,
        };
      })
      .sort((a, b) => Number(b.required) - Number(a.required) || a.fullName.localeCompare(b.fullName));

    const requiredScores = rows.filter((r) => r.required && r.score !== null).map((r) => r.score);
    return { assessment: toPublic(doc, assessmentStatistics(requiredScores, doc.maxScore, roster.size)), rows };
  }

  /**
   * Saves score changes (score: number to set, null to clear = "no score") in one transaction.
   * Rejects stale revisions so another tab's newer scores are never overwritten.
   */
  async function saveScores(instructorId, id, { revision, scores }, req) {
    const { doc, cls } = await getOwned(instructorId, id);
    assertActive(cls);

    const problems = [];
    const desired = new Map();
    scores.forEach(({ studentId, score }) => {
      if (desired.has(studentId)) problems.push({ field: studentId, message: 'Student appears more than once' });
      if (score !== null) {
        if (typeof score !== 'number' || !Number.isFinite(score)) problems.push({ field: studentId, message: 'Score must be a number' });
        else if (score < 0) problems.push({ field: studentId, message: 'Score cannot be negative' });
        else if (score > doc.maxScore) problems.push({ field: studentId, message: `Score cannot exceed the maximum of ${doc.maxScore}` });
        else if (decimalPlaces(score) > 2) problems.push({ field: studentId, message: 'Use at most 2 decimal places' });
      }
      desired.set(studentId, score);
    });
    if (problems.length) throw ApiError.validation(problems, 'Some scores are invalid');

    const rosterIds = new Set((await findRequiredStudentIds(doc.class)).map(String));
    const existing = await Score.find({ [refField]: doc._id, student: { $in: [...desired.keys()].map((sid) => new ObjectId(sid)) } }).lean();
    const existingByStudent = new Map(existing.map((s) => [s.student.toString(), s]));
    const outsiders = [...desired.keys()].filter((sid) => !rosterIds.has(sid) && !existingByStudent.has(sid));
    if (outsiders.length) {
      throw ApiError.validation(outsiders.map((sid) => ({ field: sid, message: 'Student is not enrolled in this class' })), 'Some students are not enrolled in this class');
    }

    const changes = [...desired.entries()]
      .map(([studentId, score]) => ({ studentId, score, previous: existingByStudent.get(studentId)?.score ?? null }))
      .filter((c) => c.score !== c.previous);

    // D18: once an INC has lapsed to 5.0 the subject grade is final; scores can no longer change it.
    const lapsed = await findLapsedStudentIds(doc.class, changes.map((c) => c.studentId));
    if (lapsed.length) {
      throw new ApiError(409, 'INC_LAPSED', 'The INC completion period has ended for some students; their grade is final (5.0) and scores can no longer be changed.', lapsed.map((sid) => ({ field: sid, message: 'INC lapsed — grade is final' })));
    }

    const result = await runInTransaction(async (session) => {
      const claimed = await Assessment.findOneAndUpdate({ _id: doc._id, revision, deletedAt: null }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
      if (!claimed) {
        throw new ApiError(409, 'STALE_REVISION', 'These scores were changed elsewhere (another tab or device). Reload to see the latest before saving.');
      }
      if (changes.length) {
        await Score.bulkWrite(
          changes.map((c) =>
            c.score === null
              ? { deleteOne: { filter: { [refField]: doc._id, student: new ObjectId(c.studentId) } } }
              : {
                  updateOne: {
                    filter: { [refField]: doc._id, student: new ObjectId(c.studentId) },
                    update: {
                      $set: { score: c.score, updatedBy: instructorId, period: doc.period },
                      $setOnInsert: { class: doc.class },
                    },
                    upsert: true,
                  },
                },
          ),
          { session },
        );
        await recordAudit(
          {
            userId: instructorId,
            action: `${auditPrefix}_SCORES_UPDATE`,
            collection: Score.collection.collectionName,
            recordId: doc._id,
            classId: doc.class,
            previousValue: changes.map((c) => ({ student: c.studentId, score: c.previous })),
            newValue: changes.map((c) => ({ student: c.studentId, score: c.score })),
            metadata: { title: doc.title, period: doc.period },
            req,
          },
          { session },
        );
        await notifySourceChanged(
          { classId: doc.class, periods: [doc.period], studentIds: changes.map((c) => new ObjectId(c.studentId)), reason: `${auditPrefix}_SCORES_UPDATE`, userId: instructorId },
          { session },
        );
      }
      return { changed: changes.length, revision: claimed.revision };
    });

    return { ...result, ...(await getScoreSheet(instructorId, id)) };
  }

  return { list, get, create, update, remove, getScoreSheet, saveScores };
}
