/**
 * QR self-enrollment: a student opens the class's private link (from the QR code) and enrolls
 * themselves, without signing in. Only while the instructor has it switched on.
 *
 * Rules:
 *  - one enrollment per student number per class: a second attempt is refused;
 *  - a student number the instructor already has on record is reused, but only if the last and
 *    first names match, so nobody can enroll someone else by typing their number;
 *  - a student the instructor dropped from the class cannot re-enroll themselves;
 *  - if the course, year level, or section entered differs from the class's section (e.g.
 *    "BSIT-3A" → BSIT, 3, A), the student must confirm before enrolling (irregular students
 *    may legitimately take another section's class), and the instructor sees it was confirmed.
 */
import { Class, CLASS_STATUSES } from '../models/Class.js';
import { Student, foldForSearch } from '../models/Student.js';
import { Enrollment, ENROLLMENT_STATUSES } from '../models/Enrollment.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { validateStudentInput } from '../validators/student.rules.js';
import { enrollStudentIds } from './enrollment.service.js';
import { recordAudit } from './audit.service.js';

const INVALID_LINK = 'This enrollment link is not valid. Ask your instructor for the current QR code.';
const fieldError = (field, message) => ApiError.validation([{ field, message }]);
const sameName = (a, b) => foldForSearch(a ?? '').replace(/\s+/g, ' ').trim() === foldForSearch(b ?? '').replace(/\s+/g, ' ').trim();

async function findByToken(token, { session } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw ApiError.notFound(INVALID_LINK);
  const cls = await Class.findOne({ 'selfEnrollment.token': token }).session(session ?? null);
  if (!cls) throw ApiError.notFound(INVALID_LINK);
  return cls;
}

/**
 * Reads the course, year level, and section a class is for from its section name, e.g.
 * "BSIT-3A", "BSIT 3-A", "BSCS-2B" → { course: 'BSIT', yearLevel: 3, section: 'A' }.
 * Returns null when the name has another shape (then nothing is checked).
 */
export function expectedFromClassSection(name) {
  const m = /^([A-Z][A-Z.]*)\s*-?\s*([1-6])\s*-?\s*([A-Z0-9]{1,4})$/.exec(String(name ?? '').toUpperCase().trim());
  return m ? { course: m[1].replace(/\./g, ''), yearLevel: Number(m[2]), section: m[3] } : null;
}

/** Which of course / yearLevel / section the student's entry differs from the class's. */
export function classMismatches(expected, value) {
  if (!expected) return [];
  const course = String(value.course ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // The student may type "A", "3A", "3-A", or "BSIT-3A" for their section.
  const section = String(value.section ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(new RegExp(`^(${expected.course})?${expected.yearLevel}?`), '');
  const out = [];
  if (course !== expected.course) out.push('course');
  if (Number(value.yearLevel) !== expected.yearLevel) out.push('yearLevel');
  if (section !== expected.section) out.push('section');
  return out;
}

const isOpen = (cls) => Boolean(cls.selfEnrollment?.open) && cls.status === CLASS_STATUSES.ACTIVE;

/** What the join page shows: the class, its instructor, and whether enrollment is open. */
export async function getJoinInfo(token) {
  const cls = await findByToken(token);
  const instructor = await User.findById(cls.instructor).select('name').lean();
  return {
    class: { subjectCode: cls.subjectCode, subjectTitle: cls.subjectTitle, section: cls.section, schoolYear: cls.schoolYear, semester: cls.semester },
    instructor: instructor?.name ?? null,
    open: isOpen(cls),
  };
}

export async function selfEnroll(token, input, req) {
  const { confirmMismatch = false, ...fields } = input ?? {};
  const { value, errors } = validateStudentInput(fields);
  if (errors.length) throw ApiError.validation(errors);
  try {
    return await runInTransaction(async (session) => {
      const cls = await findByToken(token, { session });
      if (!isOpen(cls)) throw ApiError.conflict('Enrollment for this class is closed. Ask your instructor.');
      const expected = expectedFromClassSection(cls.section);
      const mismatched = classMismatches(expected, value);
      if (mismatched.length && !confirmMismatch) {
        throw new ApiError(409, 'CLASS_MISMATCH', `This class is for ${expected.course} ${expected.yearLevel}-${expected.section}, but you entered ${value.course} ${value.yearLevel}-${value.section}.`, {
          expected,
          entered: { course: value.course, yearLevel: value.yearLevel, section: value.section },
          fields: mismatched,
        });
      }
      const instructorId = cls.instructor.toString();
      const classId = cls._id.toString();

      let student = await Student.findOne({ instructor: cls.instructor, studentNumber: value.studentNumber }).session(session);
      if (student) {
        if (student.archivedAt) throw ApiError.conflict('This student number cannot be enrolled online. Ask your instructor.');
        if (!sameName(student.lastName, value.lastName) || !sameName(student.firstName, value.firstName)) {
          throw fieldError('studentNumber', 'This student number is already registered under a different name. Check it, or ask your instructor.');
        }
        const enrollment = await Enrollment.findOne({ class: cls._id, student: student._id }).session(session).lean();
        if (enrollment?.status === ENROLLMENT_STATUSES.ENROLLED) throw fieldError('studentNumber', `Student number ${value.studentNumber} is already enrolled in this class.`);
        if (enrollment?.status === ENROLLMENT_STATUSES.DROPPED) throw ApiError.conflict('You were dropped from this class. Ask your instructor to reinstate you.');
      } else {
        [student] = await Student.create([{ ...value, instructor: cls.instructor }], { session });
        await recordAudit({ userId: instructorId, action: 'STUDENT_CREATE', collection: 'students', recordId: student._id, newValue: { studentNumber: student.studentNumber }, metadata: { via: 'SELF_ENROLLMENT' }, req }, { session });
      }

      await enrollStudentIds(instructorId, classId, [student._id.toString()], req, { session, audit: false });
      const fullName = `${student.lastName}, ${student.firstName}`;
      await recordAudit({ userId: instructorId, action: 'ENROLLMENT_SELF', collection: 'enrollments', classId: cls._id, recordId: student._id, newValue: { studentNumber: student.studentNumber, fullName }, metadata: { via: 'QR', ...(mismatched.length ? { confirmedMismatch: mismatched, entered: `${value.course} ${value.yearLevel}-${value.section}` } : {}) }, req }, { session });
      return {
        class: { subjectCode: cls.subjectCode, subjectTitle: cls.subjectTitle, section: cls.section },
        student: { studentNumber: student.studentNumber, fullName },
      };
    });
  } catch (error) {
    // Two submissions at the same moment: the database's unique keys catch the second one.
    if (error?.code === 11000) throw fieldError('studentNumber', `Student number ${value.studentNumber} is already enrolled in this class.`);
    throw error;
  }
}
