import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Class, CLASS_STATUSES } from '../models/Class.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from './audit.service.js';
import { ComputedGrade } from '../models/ComputedGrade.js';
import { Enrollment } from '../models/Enrollment.js';
import { runInTransaction } from '../utils/transaction.js';
import { notifySourceChanged } from './grading/grading.events.js';

const EDITABLE_FIELDS = ['subjectCode', 'subjectTitle', 'section', 'schoolYear', 'semester', 'termEndDate'];

function toPublic(doc) {
  return {
    id: doc._id.toString(),
    subjectCode: doc.subjectCode,
    subjectTitle: doc.subjectTitle,
    section: doc.section,
    schoolYear: doc.schoolYear,
    semester: doc.semester,
    termEndDate: doc.termEndDate,
    status: doc.status,
    archivedAt: doc.archivedAt ?? null,
    selfEnrollment: { open: Boolean(doc.selfEnrollment?.open), token: doc.selfEnrollment?.token ?? null },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function snapshot(doc) {
  return Object.fromEntries(EDITABLE_FIELDS.concat('status').map((f) => [f, doc[f]]));
}

function translateDuplicate(error) {
  if (error?.code === 11000) {
    return ApiError.conflict('You already have this subject and section for the same school year and semester', {
      fields: ['subjectCode', 'section', 'schoolYear', 'semester'],
    });
  }
  return error;
}

/**
 * Loads a class owned by the instructor. Classes owned by someone else are reported as
 * "not found" so their existence is not revealed.
 */
export async function getOwnedClass(instructorId, classId) {
  if (!mongoose.isValidObjectId(classId)) throw ApiError.notFound('Class not found');
  const doc = await Class.findOne({ _id: classId, instructor: instructorId });
  if (!doc) throw ApiError.notFound('Class not found');
  return doc;
}

export async function listClasses(instructorId, { status } = {}) {
  const filter = { instructor: instructorId };
  if (status) filter.status = status;
  const docs = await Class.find(filter).sort({ status: 1, schoolYear: -1, semester: 1, subjectCode: 1, section: 1 });
  return docs.map(toPublic);
}

export async function getClass(instructorId, classId) {
  return toPublic(await getOwnedClass(instructorId, classId));
}

export async function createClass(instructorId, data, req) {
  try {
    const doc = await Class.create({ ...data, instructor: instructorId });
    await recordAudit({ userId: instructorId, action: 'CLASS_CREATE', collection: 'classes', recordId: doc._id, classId: doc._id, newValue: snapshot(doc), req });
    return toPublic(doc);
  } catch (error) {
    throw translateDuplicate(error);
  }
}

export async function updateClass(instructorId, classId, data, req) {
  const doc = await getOwnedClass(instructorId, classId);
  if (doc.status === CLASS_STATUSES.ARCHIVED) throw ApiError.conflict('Restore this class before editing it');
  const before = snapshot(doc);
  for (const field of EDITABLE_FIELDS) {
    if (data[field] !== undefined) doc[field] = data[field];
  }
  const termChanged = doc.isModified('schoolYear') || doc.isModified('semester');
  const deadlineChanged = doc.isModified('termEndDate');
  try {
    await runInTransaction(async (session) => {
      await doc.save({ session });
      // Computed grades are keyed by academic period: keep them attached to the class.
      if (termChanged) {
        await ComputedGrade.updateMany({ class: doc._id }, { $set: { schoolYear: doc.schoolYear, semester: doc.semester } }, { session });
      }
      await recordAudit(
        { userId: instructorId, action: 'CLASS_UPDATE', collection: 'classes', recordId: doc._id, classId: doc._id, previousValue: before, newValue: snapshot(doc), req },
        { session },
      );
      // The INC deadline is termEndDate + 1 year: overall grades must be re-evaluated.
      if (deadlineChanged) {
        const students = await Enrollment.find({ class: doc._id }).session(session).select('student').lean();
        await notifySourceChanged({ classId: doc._id, periods: [], studentIds: students.map((e) => e.student), reason: 'CLASS_TERM_END_CHANGE', userId: instructorId }, { session });
      }
    });
  } catch (error) {
    throw translateDuplicate(error);
  }
  return toPublic(doc);
}

/** Classes are never hard-deleted: archiving keeps every academic record intact. */
export async function setArchived(instructorId, classId, archived, req) {
  const doc = await getOwnedClass(instructorId, classId);
  const target = archived ? CLASS_STATUSES.ARCHIVED : CLASS_STATUSES.ACTIVE;
  if (doc.status === target) return toPublic(doc);
  const before = snapshot(doc);
  doc.status = target;
  doc.archivedAt = archived ? new Date() : null;
  await doc.save();
  await recordAudit({
    userId: instructorId,
    action: archived ? 'CLASS_ARCHIVE' : 'CLASS_RESTORE',
    collection: 'classes',
    recordId: doc._id,
    classId: doc._id,
    previousValue: before,
    newValue: snapshot(doc),
    req,
  });
  return toPublic(doc);
}

/* ───────── QR self-enrollment (instructor controls) ───────── */

const newJoinToken = () => crypto.randomBytes(18).toString('base64url'); // 24 chars, unguessable

/** Turns QR self-enrollment on or off. Turning it on the first time creates the private link. */
export async function setSelfEnrollment(instructorId, classId, open, req) {
  const cls = await getOwnedClass(instructorId, classId);
  if (open && cls.status !== CLASS_STATUSES.ACTIVE) throw ApiError.conflict('This class is archived. Restore it to accept enrollments.');
  cls.selfEnrollment = { open, token: cls.selfEnrollment?.token || newJoinToken(), changedAt: new Date() };
  await cls.save();
  await recordAudit({ userId: instructorId, action: open ? 'CLASS_SELF_ENROLL_OPEN' : 'CLASS_SELF_ENROLL_CLOSE', collection: 'classes', recordId: cls._id, classId: cls._id, req });
  return toPublic(cls);
}

/** Replaces the private link: QR codes and links shared earlier stop working. */
export async function regenerateJoinToken(instructorId, classId, req) {
  const cls = await getOwnedClass(instructorId, classId);
  cls.selfEnrollment = { open: Boolean(cls.selfEnrollment?.open), token: newJoinToken(), changedAt: new Date() };
  await cls.save();
  await recordAudit({ userId: instructorId, action: 'CLASS_SELF_ENROLL_NEW_LINK', collection: 'classes', recordId: cls._id, classId: cls._id, req });
  return toPublic(cls);
}
