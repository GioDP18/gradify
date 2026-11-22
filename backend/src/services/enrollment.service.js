import mongoose from 'mongoose';
import { Enrollment, ENROLLMENT_STATUSES } from '../models/Enrollment.js';
import { Student, formatFullName } from '../models/Student.js';
import { CLASS_STATUSES } from '../models/Class.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { recordAudit } from './audit.service.js';
import { getOwnedClass } from './class.service.js';
import { notifySourceChanged } from './grading/grading.events.js';
import { deleteComputedFor } from './grading/grading.repository.js';

/**
 * Collections holding per-student academic records for a class. An enrollment that has
 * any of these can be dropped (→ DRP) but never removed, so history is preserved.
 */
export const ACADEMIC_RECORD_COLLECTIONS = ['attendanceRecords', 'quizScores', 'activityScores', 'examinationScores'];

async function assertActiveClass(instructorId, classId, { session } = {}) {
  const cls = await getOwnedClass(instructorId, classId);
  if (cls.status !== CLASS_STATUSES.ACTIVE) throw ApiError.conflict('This class is archived. Restore it to change enrollments.');
  return cls;
}

/**
 * Enrolls the given (already ownership-checked or to-be-checked) students in a class.
 * Re-enrolls previously dropped students. Idempotent for students already enrolled.
 */
export async function enrollStudentIds(instructorId, classId, studentIds, req, { session, audit = true } = {}) {
  await assertActiveClass(instructorId, classId, { session });
  const ids = [...new Set(studentIds.map(String))];
  const students = await Student.find({ _id: { $in: ids }, instructor: instructorId }).session(session ?? null).lean();
  if (students.length !== ids.length) throw ApiError.notFound('One or more students were not found');
  const archived = students.filter((s) => s.archivedAt);
  if (archived.length) {
    throw ApiError.conflict('Archived students cannot be enrolled', { studentNumbers: archived.map((s) => s.studentNumber) });
  }

  const existing = await Enrollment.find({ class: classId, student: { $in: ids } }).session(session ?? null).lean();
  const existingByStudent = new Map(existing.map((e) => [e.student.toString(), e]));
  const result = { enrolled: 0, reinstated: 0, alreadyEnrolled: 0 };

  const toCreate = [];
  for (const id of ids) {
    const current = existingByStudent.get(id);
    if (!current) toCreate.push({ class: classId, student: id });
    else if (current.status === ENROLLMENT_STATUSES.DROPPED) {
      await Enrollment.updateOne(
        { _id: current._id },
        { $set: { status: ENROLLMENT_STATUSES.ENROLLED, droppedAt: null, dropReason: null } },
        { session },
      );
      result.reinstated += 1;
    } else result.alreadyEnrolled += 1;
  }
  if (toCreate.length) {
    await Enrollment.insertMany(toCreate, { session });
    result.enrolled = toCreate.length;
  }

  if (result.enrolled || result.reinstated) {
    const changedIds = ids.filter((id) => existingByStudent.get(id)?.status !== ENROLLMENT_STATUSES.ENROLLED);
    await notifySourceChanged({ classId, periods: ['MIDTERM', 'FINALS'], studentIds: changedIds, reason: 'ENROLLMENT_ADD', userId: instructorId }, { session });
    if (audit) await recordAudit(
      {
        userId: instructorId,
        action: 'ENROLLMENT_ADD',
        collection: 'enrollments',
        classId,
        newValue: { studentIds: ids, ...result },
        req,
      },
      { session },
    );
  }
  return result;
}

export async function enrollStudents(instructorId, classId, studentIds, req) {
  for (const id of studentIds) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.validation([{ field: 'studentIds', message: 'Every student ID must be valid' }]);
  }
  return runInTransaction((session) => enrollStudentIds(instructorId, classId, studentIds, req, { session }));
}

async function getEnrollment(instructorId, classId, studentId) {
  await getOwnedClass(instructorId, classId);
  if (!mongoose.isValidObjectId(studentId)) throw ApiError.notFound('Enrollment not found');
  const enrollment = await Enrollment.findOne({ class: classId, student: studentId });
  if (!enrollment) throw ApiError.notFound('This student is not enrolled in the class');
  return enrollment;
}

/** Drops (→ DRP) or reinstates a student in a class. */
export async function setEnrollmentStatus(instructorId, classId, studentId, { status, reason }, req) {
  await assertActiveClass(instructorId, classId);
  const enrollment = await getEnrollment(instructorId, classId, studentId);
  if (enrollment.status === status) return enrollment.toObject();

  const before = { status: enrollment.status, droppedAt: enrollment.droppedAt, dropReason: enrollment.dropReason };
  enrollment.status = status;
  enrollment.droppedAt = status === ENROLLMENT_STATUSES.DROPPED ? new Date() : null;
  enrollment.dropReason = status === ENROLLMENT_STATUSES.DROPPED ? reason?.trim() || null : null;
  await runInTransaction(async (session) => {
    await enrollment.save({ session });
    await recordAudit(
      {
        userId: instructorId,
        action: status === ENROLLMENT_STATUSES.DROPPED ? 'ENROLLMENT_DROP' : 'ENROLLMENT_REINSTATE',
        collection: 'enrollments',
        recordId: enrollment._id,
        classId,
        previousValue: before,
        newValue: { status: enrollment.status, droppedAt: enrollment.droppedAt, dropReason: enrollment.dropReason },
        metadata: { studentId },
        req,
      },
      { session },
    );
    // DRP replaces (or restores) the student's grades in both periods.
    await notifySourceChanged({ classId, periods: ['MIDTERM', 'FINALS'], studentIds: [studentId], reason: 'ENROLLMENT_STATUS', userId: instructorId }, { session });
  });
  return enrollment.toObject();
}

export async function countAcademicRecords(classId, studentId, { session } = {}) {
  const db = mongoose.connection.db;
  const filter = { class: new mongoose.Types.ObjectId(String(classId)), student: new mongoose.Types.ObjectId(String(studentId)) };
  // Sequential: a transaction session cannot run operations in parallel.
  const counts = [];
  for (const name of ACADEMIC_RECORD_COLLECTIONS) {
    counts.push(await db.collection(name).countDocuments(filter, session ? { session } : {}));
  }
  return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * Removes an enrollment created by mistake. Refused once the student has any attendance
 * or score in the class — use "drop" instead so the academic history is preserved.
 */
export async function removeEnrollment(instructorId, classId, studentId, req) {
  await assertActiveClass(instructorId, classId);
  const enrollment = await getEnrollment(instructorId, classId, studentId);
  await runInTransaction(async (session) => {
    if ((await countAcademicRecords(classId, studentId, { session })) > 0) {
      throw ApiError.conflict('This student already has attendance or scores in this class. Drop the student instead (recorded as DRP).');
    }
    await Enrollment.deleteOne({ _id: enrollment._id }, { session });
    // Derived grades of a mistaken enrollment (with no academic records) are simply removed.
    await deleteComputedFor(classId, studentId, { session });
    await recordAudit(
      {
        userId: instructorId,
        action: 'ENROLLMENT_REMOVE',
        collection: 'enrollments',
        recordId: enrollment._id,
        classId,
        previousValue: enrollment.toObject(),
        metadata: { studentId },
        req,
      },
      { session },
    );
  });
}

/**
 * Students currently enrolled in a class: enrollment ENROLLED, not archived, and university
 * status ENROLLED. They get new attendance records and are required to have every published
 * assessment score. One definition shared by attendance, assessments, and grading.
 */
export async function findCurrentlyEnrolledStudentIds(classId, { session } = {}) {
  const enrollments = await Enrollment.find({ class: classId, status: ENROLLMENT_STATUSES.ENROLLED }).session(session ?? null).lean();
  const students = await Student.find({
    _id: { $in: enrollments.map((e) => e.student) },
    archivedAt: null,
    enrollmentStatus: 'ENROLLED',
  })
    .session(session ?? null)
    .select('_id')
    .lean();
  return students.map((s) => s._id);
}

/**
 * Students who are graded in the class and must have every published score: every enrollment
 * with status ENROLLED, regardless of the student's archive or university status. (DROPPED
 * enrollments are graded as DRP.) The grading engine, score sheets, and score validation all
 * use this definition, so a requirement can always be completed by whoever it applies to.
 */
export async function findRequiredStudentIds(classId, { session } = {}) {
  const enrollments = await Enrollment.find({ class: classId, status: ENROLLMENT_STATUSES.ENROLLED }).session(session ?? null).select('student').lean();
  return enrollments.map((e) => e.student);
}

/** Every student with an enrollment in the class (enrolled or dropped) — everyone who has computed grades. */
export async function findAllEnrolledStudentIds(classId, { session } = {}) {
  const enrollments = await Enrollment.find({ class: classId }).session(session ?? null).select('student').lean();
  return enrollments.map((e) => e.student);
}

/** Roster of a class (both statuses) with student details. */
export async function listClassRoster(instructorId, classId) {
  await getOwnedClass(instructorId, classId);
  const enrollments = await Enrollment.find({ class: classId }).lean();
  const students = await Student.find({ _id: { $in: enrollments.map((e) => e.student) }, instructor: instructorId }).lean();
  const byId = new Map(students.map((s) => [s._id.toString(), s]));
  return enrollments
    .filter((e) => byId.has(e.student.toString()))
    .map((e) => {
      const s = byId.get(e.student.toString());
      return {
        studentId: s._id.toString(),
        studentNumber: s.studentNumber,
        fullName: formatFullName(s),
        archived: Boolean(s.archivedAt),
        status: e.status,
        enrolledAt: e.enrolledAt,
        droppedAt: e.droppedAt ?? null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
