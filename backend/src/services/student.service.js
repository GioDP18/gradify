import mongoose from 'mongoose';
import { Student, formatFullName, foldForSearch } from '../models/Student.js';
import { Enrollment } from '../models/Enrollment.js';
import { Class } from '../models/Class.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/strings.js';
import { runInTransaction } from '../utils/transaction.js';
import { validateStudentInput } from '../validators/student.rules.js';
import { recordAudit } from './audit.service.js';
import { getOwnedClass } from './class.service.js';
import { enrollStudentIds } from './enrollment.service.js';

export const SORTABLE_FIELDS = ['studentNumber', 'lastName', 'firstName', 'course', 'yearLevel', 'section', 'enrollmentStatus', 'createdAt'];
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };
const AUDITED_FIELDS = ['studentNumber', 'firstName', 'middleName', 'lastName', 'email', 'course', 'yearLevel', 'section', 'enrollmentStatus', 'archivedAt'];

export function toPublicStudent(doc, enrollment) {
  const out = {
    id: doc._id.toString(),
    studentNumber: doc.studentNumber,
    firstName: doc.firstName,
    middleName: doc.middleName ?? null,
    lastName: doc.lastName,
    fullName: formatFullName(doc),
    email: doc.email ?? null,
    course: doc.course,
    yearLevel: doc.yearLevel,
    section: doc.section,
    enrollmentStatus: doc.enrollmentStatus,
    archivedAt: doc.archivedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (enrollment) {
    out.enrollment = { status: enrollment.status, enrolledAt: enrollment.enrolledAt, droppedAt: enrollment.droppedAt ?? null };
  }
  return out;
}

const snapshot = (doc) => Object.fromEntries(AUDITED_FIELDS.map((f) => [f, doc[f] ?? null]));

function duplicateNumberError(studentNumber) {
  return ApiError.conflict(`Student number ${studentNumber} already exists in your roster`, { fields: ['studentNumber'] });
}

export async function getOwnedStudent(instructorId, studentId, { session } = {}) {
  if (!mongoose.isValidObjectId(studentId)) throw ApiError.notFound('Student not found');
  const doc = await Student.findOne({ _id: studentId, instructor: instructorId }).session(session ?? null);
  if (!doc) throw ApiError.notFound('Student not found');
  return doc;
}

/**
 * Builds the MongoDB filter for roster queries. When classId is given, the result is
 * limited to students enrolled in that class and the enrollment of each is returned too.
 */
async function buildFilter(instructorId, query) {
  const filter = { instructor: instructorId };
  filter.archivedAt = query.archived ? { $ne: null } : null;
  if (query.course) filter.course = query.course.trim().toUpperCase();
  if (query.section) filter.section = query.section.trim().toUpperCase();
  if (query.yearLevel) filter.yearLevel = Number(query.yearLevel);
  if (query.status) filter.enrollmentStatus = query.status;

  // Every word must appear somewhere in the student's accent-insensitive search key.
  const terms = foldForSearch(query.search ?? '').split(/[\s,]+/).filter(Boolean).slice(0, 5);
  if (terms.length) {
    filter.$and = terms.map((term) => ({ searchKey: new RegExp(escapeRegex(term)) }));
  }

  let enrollmentByStudent = null;
  if (query.classId) {
    await getOwnedClass(instructorId, query.classId);
    const enrollmentFilter = { class: query.classId };
    if (query.enrollment) enrollmentFilter.status = query.enrollment;
    const enrollments = await Enrollment.find(enrollmentFilter).lean();
    enrollmentByStudent = new Map(enrollments.map((e) => [e.student.toString(), e]));
    filter._id = { $in: enrollments.map((e) => e.student) };
  }
  return { filter, enrollmentByStudent };
}

function buildSort(query) {
  const field = SORTABLE_FIELDS.includes(query.sort) ? query.sort : 'lastName';
  const dir = query.order === 'desc' ? -1 : 1;
  return { [field]: dir, lastName: 1, firstName: 1, _id: 1 };
}

export async function listStudents(instructorId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const { filter, enrollmentByStudent } = await buildFilter(instructorId, query);

  const [docs, total] = await Promise.all([
    Student.find(filter).collation(CASE_INSENSITIVE).sort(buildSort(query)).skip((page - 1) * limit).limit(limit).lean(),
    Student.countDocuments(filter),
  ]);

  return {
    items: docs.map((doc) => toPublicStudent(doc, enrollmentByStudent?.get(doc._id.toString()))),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** All matching students (no pagination) for exports. Capped to protect the server. */
export async function findStudentsForExport(instructorId, query = {}, cap = 10000) {
  const { filter, enrollmentByStudent } = await buildFilter(instructorId, query);
  const docs = await Student.find(filter).collation(CASE_INSENSITIVE).sort(buildSort(query)).limit(cap).lean();
  return docs.map((doc) => toPublicStudent(doc, enrollmentByStudent?.get(doc._id.toString())));
}

export async function getFacets(instructorId) {
  const match = { instructor: instructorId, archivedAt: null };
  const [courses, sections, yearLevels] = await Promise.all([
    Student.distinct('course', match),
    Student.distinct('section', match),
    Student.distinct('yearLevel', match),
  ]);
  const byText = (a, b) => a.localeCompare(b);
  return { courses: courses.sort(byText), sections: sections.sort(byText), yearLevels: yearLevels.sort((a, b) => a - b) };
}

export async function getStudentDetail(instructorId, studentId) {
  const student = await getOwnedStudent(instructorId, studentId);
  const enrollments = await Enrollment.find({ student: student._id }).lean();
  const classes = await Class.find({ _id: { $in: enrollments.map((e) => e.class) }, instructor: instructorId }).lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  return {
    ...toPublicStudent(student),
    enrollments: enrollments
      .filter((e) => classById.has(e.class.toString()))
      .map((e) => {
        const cls = classById.get(e.class.toString());
        return {
          classId: cls._id.toString(),
          subjectCode: cls.subjectCode,
          subjectTitle: cls.subjectTitle,
          section: cls.section,
          schoolYear: cls.schoolYear,
          semester: cls.semester,
          classStatus: cls.status,
          status: e.status,
          enrolledAt: e.enrolledAt,
          droppedAt: e.droppedAt ?? null,
          dropReason: e.dropReason ?? null,
        };
      })
      .sort((a, b) => b.schoolYear.localeCompare(a.schoolYear) || a.subjectCode.localeCompare(b.subjectCode)),
  };
}

export async function createStudent(instructorId, input, { classId } = {}, req) {
  const { value, errors } = validateStudentInput(input);
  if (errors.length) throw ApiError.validation(errors);

  if (await Student.exists({ instructor: instructorId, studentNumber: value.studentNumber })) {
    throw duplicateNumberError(value.studentNumber);
  }
  if (classId) await getOwnedClass(instructorId, classId);

  try {
    const student = await runInTransaction(async (session) => {
      const [doc] = await Student.create([{ ...value, instructor: instructorId }], { session });
      await recordAudit(
        { userId: instructorId, action: 'STUDENT_CREATE', collection: 'students', recordId: doc._id, newValue: snapshot(doc), req },
        { session },
      );
      if (classId) await enrollStudentIds(instructorId, classId, [doc._id], req, { session });
      return doc;
    });
    return toPublicStudent(student);
  } catch (error) {
    if (error?.code === 11000) throw duplicateNumberError(value.studentNumber);
    throw error;
  }
}

export async function updateStudent(instructorId, studentId, input, req) {
  const { value, errors } = validateStudentInput(input, { partial: true });
  if (errors.length) throw ApiError.validation(errors);

  const doc = await getOwnedStudent(instructorId, studentId);
  if (doc.archivedAt) throw ApiError.conflict('Restore this student before editing their information');

  if (value.studentNumber && value.studentNumber !== doc.studentNumber) {
    if (await Student.exists({ instructor: instructorId, studentNumber: value.studentNumber, _id: { $ne: doc._id } })) {
      throw duplicateNumberError(value.studentNumber);
    }
  }

  const before = snapshot(doc);
  Object.assign(doc, value);
  if (!doc.isModified()) return toPublicStudent(doc);
  try {
    await doc.save();
  } catch (error) {
    if (error?.code === 11000) throw duplicateNumberError(value.studentNumber);
    throw error;
  }
  await recordAudit({ userId: instructorId, action: 'STUDENT_UPDATE', collection: 'students', recordId: doc._id, previousValue: before, newValue: snapshot(doc), req });
  return toPublicStudent(doc);
}

/**
 * Archival is the deletion policy: the student disappears from active rosters and new
 * attendance sessions / score sheets, while every historical record is preserved.
 */
export async function setStudentArchived(instructorId, studentId, archived, req) {
  const doc = await getOwnedStudent(instructorId, studentId);
  if (Boolean(doc.archivedAt) === archived) return toPublicStudent(doc);
  const before = snapshot(doc);
  doc.archivedAt = archived ? new Date() : null;
  doc.archivedBy = archived ? instructorId : null;
  await doc.save();
  await recordAudit({
    userId: instructorId,
    action: archived ? 'STUDENT_ARCHIVE' : 'STUDENT_RESTORE',
    collection: 'students',
    recordId: doc._id,
    previousValue: before,
    newValue: snapshot(doc),
    req,
  });
  return toPublicStudent(doc);
}
