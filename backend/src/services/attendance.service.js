import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AttendanceSession } from '../models/AttendanceSession.js';
import { AttendanceRecord } from '../models/AttendanceRecord.js';
import { Enrollment } from '../models/Enrollment.js';
import { Student, formatFullName } from '../models/Student.js';
import { Class, CLASS_STATUSES } from '../models/Class.js';
import { GRADING_PERIODS } from '../models/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { parseDateOnly, formatDateOnly, todayInTimeZone } from '../utils/dates.js';
import { recordAudit } from './audit.service.js';
import { getOwnedClass } from './class.service.js';
import { findCurrentlyEnrolledStudentIds } from './enrollment.service.js';
import { attendancePercentage } from './grading/grading.calculator.js';
import { notifySourceChanged } from './grading/grading.events.js';

const { ObjectId } = mongoose.Types;

function toPublicSession(session, counts) {
  const c = counts ?? { present: 0, absent: 0, excused: 0, total: 0 };
  return {
    id: session._id.toString(),
    classId: session.class.toString(),
    sessionDate: formatDateOnly(session.sessionDate),
    period: session.period,
    description: session.description ?? null,
    revision: session.revision ?? 0,
    counts: c,
    attendanceRate: attendancePercentage(c),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function validateSessionDate(value) {
  const date = parseDateOnly(value);
  if (!date) throw ApiError.validation([{ field: 'sessionDate', message: 'Enter a valid session date.' }]);
  if (value > todayInTimeZone(env.timezone)) {
    throw ApiError.validation([{ field: 'sessionDate', message: 'Attendance cannot be recorded for a future date' }]);
  }
  return date;
}

function duplicateSessionError(date, period) {
  return ApiError.conflict(`An attendance session for ${formatDateOnly(date)} (${period === 'MIDTERM' ? 'Midterm' : 'Finals'}) already exists for this class`, {
    fields: ['sessionDate', 'period'],
  });
}

/** Status counts per session id, from one aggregation. */
async function countsBySession(sessionIds) {
  const rows = await AttendanceRecord.aggregate([
    { $match: { session: { $in: sessionIds } } },
    { $group: { _id: { session: '$session', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const { _id, n } of rows) {
    const key = _id.session.toString();
    const c = map.get(key) ?? { present: 0, absent: 0, excused: 0, total: 0 };
    c[_id.status.toLowerCase()] += n;
    c.total += n;
    map.set(key, c);
  }
  return map;
}

async function getOwnedSession(instructorId, sessionId) {
  if (!mongoose.isValidObjectId(sessionId)) throw ApiError.notFound('Attendance session not found');
  const session = await AttendanceSession.findById(sessionId);
  if (!session) throw ApiError.notFound('Attendance session not found');
  const cls = await getOwnedClass(instructorId, session.class).catch(() => {
    throw ApiError.notFound('Attendance session not found');
  });
  return { session, cls };
}

function assertClassActive(cls) {
  if (cls.status !== CLASS_STATUSES.ACTIVE) throw ApiError.conflict('This class is archived. Restore it to change attendance.');
}

export async function listSessions(instructorId, { classId, period, from, to, page = 1, limit = 50 }) {
  await getOwnedClass(instructorId, classId);
  const filter = { class: classId };
  if (period) filter.period = period;
  if (from || to) {
    filter.sessionDate = {};
    if (from) filter.sessionDate.$gte = parseDateOnly(from);
    if (to) filter.sessionDate.$lte = parseDateOnly(to);
  }
  const [sessions, total] = await Promise.all([
    AttendanceSession.find(filter).sort({ sessionDate: -1, period: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    AttendanceSession.countDocuments(filter),
  ]);
  const counts = await countsBySession(sessions.map((s) => s._id));
  return {
    items: sessions.map((s) => toPublicSession(s, counts.get(s._id.toString()))),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getSession(instructorId, sessionId) {
  const { session } = await getOwnedSession(instructorId, sessionId);
  const counts = await countsBySession([session._id]);
  return toPublicSession(session, counts.get(session._id.toString()));
}

/**
 * Creates a session and — on the server — one PRESENT record for every currently enrolled
 * student, atomically. Students enrolled later never appear in this session.
 */
export async function createSession(instructorId, { classId, period, sessionDate, description }, req) {
  const cls = await getOwnedClass(instructorId, classId);
  assertClassActive(cls);
  const date = validateSessionDate(sessionDate);

  if (await AttendanceSession.exists({ class: classId, sessionDate: date, period })) throw duplicateSessionError(date, period);

  try {
    const created = await runInTransaction(async (txn) => {
      const studentIds = await findCurrentlyEnrolledStudentIds(classId, { session: txn });
      if (studentIds.length === 0) {
        throw ApiError.conflict('No students are currently enrolled in this class. Enroll students before taking attendance.');
      }
      const [doc] = await AttendanceSession.create(
        [{ class: classId, period, sessionDate: date, description: description || null, createdBy: instructorId }],
        { session: txn },
      );
      await AttendanceRecord.insertMany(
        studentIds.map((student) => ({ session: doc._id, student, class: classId, period, status: 'PRESENT' })),
        { session: txn },
      );
      await recordAudit(
        {
          userId: instructorId,
          action: 'ATTENDANCE_SESSION_CREATE',
          collection: 'attendanceSessions',
          recordId: doc._id,
          classId,
          newValue: { sessionDate: formatDateOnly(date), period, description: doc.description, students: studentIds.length },
          req,
        },
        { session: txn },
      );
      await notifySourceChanged({ classId, periods: [period], studentIds, reason: 'ATTENDANCE_SESSION_CREATE', userId: instructorId }, { session: txn });
      return { doc, total: studentIds.length };
    });
    return toPublicSession(created.doc, { present: created.total, absent: 0, excused: 0, total: created.total });
  } catch (error) {
    if (error?.code === 11000) throw duplicateSessionError(date, period);
    throw error;
  }
}

/** Edits date/description. The grading period is locked once records exist (D12). */
export async function updateSession(instructorId, sessionId, { sessionDate, description, period }, req) {
  const { session, cls } = await getOwnedSession(instructorId, sessionId);
  assertClassActive(cls);
  const before = { sessionDate: formatDateOnly(session.sessionDate), period: session.period, description: session.description };

  if (period !== undefined && period !== session.period) {
    if (await AttendanceRecord.exists({ session: session._id })) {
      throw ApiError.conflict('The grading period cannot be changed after attendance has been recorded. Delete and recreate the session instead.');
    }
    session.period = period;
  }
  if (sessionDate !== undefined) session.sessionDate = validateSessionDate(sessionDate);
  if (description !== undefined) session.description = description || null;
  if (!session.isModified()) return getSession(instructorId, sessionId);

  if (
    (session.isModified('sessionDate') || session.isModified('period')) &&
    (await AttendanceSession.exists({ class: session.class, sessionDate: session.sessionDate, period: session.period, _id: { $ne: session._id } }))
  ) {
    throw duplicateSessionError(session.sessionDate, session.period);
  }
  try {
    await session.save();
  } catch (error) {
    if (error?.code === 11000) throw duplicateSessionError(session.sessionDate, session.period);
    throw error;
  }
  await recordAudit({
    userId: instructorId,
    action: 'ATTENDANCE_SESSION_UPDATE',
    collection: 'attendanceSessions',
    recordId: session._id,
    classId: session.class,
    previousValue: before,
    newValue: { sessionDate: formatDateOnly(session.sessionDate), period: session.period, description: session.description },
    req,
  });
  return getSession(instructorId, sessionId);
}

/** Deletes a session and its records atomically; the full snapshot is kept in the audit log. */
export async function deleteSession(instructorId, sessionId, req) {
  const { session, cls } = await getOwnedSession(instructorId, sessionId);
  assertClassActive(cls);
  await runInTransaction(async (txn) => {
    const records = await AttendanceRecord.find({ session: session._id }).session(txn).lean();
    await AttendanceRecord.deleteMany({ session: session._id }, { session: txn });
    await AttendanceSession.deleteOne({ _id: session._id }, { session: txn });
    await recordAudit(
      {
        userId: instructorId,
        action: 'ATTENDANCE_SESSION_DELETE',
        collection: 'attendanceSessions',
        recordId: session._id,
        classId: session.class,
        previousValue: {
          sessionDate: formatDateOnly(session.sessionDate),
          period: session.period,
          description: session.description,
          records: records.map((r) => ({ student: r.student.toString(), status: r.status })),
        },
        req,
      },
      { session: txn },
    );
    await notifySourceChanged(
      { classId: session.class, periods: [session.period], studentIds: records.map((r) => r.student), reason: 'ATTENDANCE_SESSION_DELETE', userId: instructorId },
      { session: txn },
    );
  });
}

export async function getSessionRecords(instructorId, sessionId) {
  const { session } = await getOwnedSession(instructorId, sessionId);
  const records = await AttendanceRecord.find({ session: session._id }).lean();
  const students = await Student.find({ _id: { $in: records.map((r) => r.student) } }).lean();
  const enrollments = await Enrollment.find({ class: session.class, student: { $in: records.map((r) => r.student) } }).lean();
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));
  const enrollmentByStudent = new Map(enrollments.map((e) => [e.student.toString(), e]));

  const counts = await countsBySession([session._id]);
  return {
    session: toPublicSession(session, counts.get(session._id.toString())),
    records: records
      .map((r) => {
        const s = studentById.get(r.student.toString());
        return {
          studentId: r.student.toString(),
          studentNumber: s?.studentNumber ?? '—',
          fullName: s ? formatFullName(s) : 'Unknown student',
          status: r.status,
          archived: Boolean(s?.archivedAt),
          enrollmentStatus: enrollmentByStudent.get(r.student.toString())?.status ?? null,
          updatedAt: r.updatedAt,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}

/**
 * Saves status changes for one session in a single transaction.
 * `revision` must match the session's current revision, so a stale page (e.g. another tab
 * saved first) cannot silently overwrite newer changes.
 */
export async function updateSessionRecords(instructorId, sessionId, { revision, records }, req) {
  const { session, cls } = await getOwnedSession(instructorId, sessionId);
  assertClassActive(cls);

  const byStudent = new Map();
  for (const { studentId, status } of records) {
    if (byStudent.has(studentId)) throw ApiError.validation([{ field: 'records', message: 'Each student may appear only once' }]);
    byStudent.set(studentId, status);
  }

  const result = await runInTransaction(async (txn) => {
    // Claim the revision atomically: only one concurrent save can win.
    const claimed = await AttendanceSession.findOneAndUpdate(
      { _id: session._id, revision },
      { $inc: { revision: 1 } },
      { session: txn, returnDocument: 'after' },
    );
    if (!claimed) {
      throw new ApiError(409, 'STALE_REVISION', 'This attendance was changed elsewhere (another tab or device). Reload to see the latest before saving.');
    }

    const existing = await AttendanceRecord.find({ session: session._id, student: { $in: [...byStudent.keys()].map((id) => new ObjectId(id)) } })
      .session(txn)
      .lean();
    if (existing.length !== byStudent.size) {
      throw ApiError.validation([{ field: 'records', message: 'One or more students are not part of this attendance session' }]);
    }

    const changes = existing.filter((r) => r.status !== byStudent.get(r.student.toString()));
    if (changes.length) {
      await AttendanceRecord.bulkWrite(
        changes.map((r) => ({
          updateOne: { filter: { _id: r._id }, update: { $set: { status: byStudent.get(r.student.toString()), updatedBy: instructorId } } },
        })),
        { session: txn },
      );
      await recordAudit(
        {
          userId: instructorId,
          action: 'ATTENDANCE_RECORDS_UPDATE',
          collection: 'attendanceRecords',
          recordId: session._id,
          classId: session.class,
          previousValue: changes.map((r) => ({ student: r.student.toString(), status: r.status })),
          newValue: changes.map((r) => ({ student: r.student.toString(), status: byStudent.get(r.student.toString()) })),
          metadata: { sessionDate: formatDateOnly(session.sessionDate), period: session.period },
          req,
        },
        { session: txn },
      );
      await notifySourceChanged(
        { classId: session.class, periods: [session.period], studentIds: changes.map((r) => r.student), reason: 'ATTENDANCE_RECORDS_UPDATE', userId: instructorId },
        { session: txn },
      );
    }
    return { changed: changes.length, revision: claimed.revision };
  });

  return { ...result, ...(await getSessionRecords(instructorId, sessionId)) };
}

/**
 * Attendance summary per student (and per grading period), computed from actual records.
 * attendanceRate uses the official attendance formula from the grading calculator.
 */
export async function getSummary(instructorId, { classId, period, studentId }) {
  if (!classId && !studentId) throw ApiError.validation([{ field: 'classId', message: 'Choose a class or a student.' }]);
  const match = {};
  if (classId) {
    await getOwnedClass(instructorId, classId);
    match.class = new ObjectId(classId);
  }
  if (studentId) {
    const student = await Student.findOne({ _id: studentId, instructor: instructorId }).lean();
    if (!student) throw ApiError.notFound('Student not found');
    match.student = student._id;
  }
  if (period) match.period = period;

  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: { _id: { class: '$class', period: '$period', student: '$student', status: '$status' }, n: { $sum: 1 } } },
  ]);

  // Only report classes this instructor owns (matters for studentId-only queries).
  const ownedClassIds = new Set();
  if (!classId) {
    const owned = await Class.find({ instructor: instructorId, _id: { $in: [...new Set(rows.map((r) => r._id.class.toString()))] } }).select('_id').lean();
    owned.forEach((c) => ownedClassIds.add(c._id.toString()));
  }

  const byKey = new Map();
  const periodTotals = new Map();
  for (const { _id, n } of rows) {
    if (!classId && !ownedClassIds.has(_id.class.toString())) continue;
    const key = `${_id.class}|${_id.period}|${_id.student}`;
    const entry = byKey.get(key) ?? { classId: _id.class.toString(), period: _id.period, studentId: _id.student.toString(), present: 0, absent: 0, excused: 0, total: 0 };
    entry[_id.status.toLowerCase()] += n;
    entry.total += n;
    byKey.set(key, entry);

    const pKey = `${_id.class}|${_id.period}`;
    const p = periodTotals.get(pKey) ?? { classId: _id.class.toString(), period: _id.period, present: 0, absent: 0, excused: 0, total: 0 };
    p[_id.status.toLowerCase()] += n;
    p.total += n;
    periodTotals.set(pKey, p);
  }

  const studentIds = [...new Set([...byKey.values()].map((e) => e.studentId))];
  const students = await Student.find({ _id: { $in: studentIds } }).lean();
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const sessionCounts = await AttendanceSession.aggregate([
    { $match: { ...(match.class ? { class: match.class } : {}), ...(period ? { period } : {}) } },
    { $group: { _id: { class: '$class', period: '$period' }, sessions: { $sum: 1 } } },
  ]);
  const sessionsByPeriod = new Map(sessionCounts.map((r) => [`${r._id.class}|${r._id.period}`, r.sessions]));

  return {
    students: [...byKey.values()]
      .map((e) => {
        const s = studentById.get(e.studentId);
        return { ...e, studentNumber: s?.studentNumber, fullName: s ? formatFullName(s) : 'Unknown student', attendanceRate: attendancePercentage(e) };
      })
      .sort((a, b) => GRADING_PERIODS.indexOf(a.period) - GRADING_PERIODS.indexOf(b.period) || a.fullName.localeCompare(b.fullName)),
    periods: [...periodTotals.values()].map((p) => ({
      ...p,
      sessions: sessionsByPeriod.get(`${p.classId}|${p.period}`) ?? 0,
      attendanceRate: attendancePercentage(p),
    })),
  };
}
