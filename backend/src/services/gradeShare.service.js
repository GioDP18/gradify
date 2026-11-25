/**
 * Sharing a student's grading sheet with that student, so they can see for themselves how their
 * grade was computed. The instructor creates a private link for one student in one class, either
 * for a limited time or with no time limit, and can stop it at any moment. The link can be copied
 * or emailed to the address on the student's record.
 *
 * Rules:
 *  - the link shows only that student's sheet for that class, read live from the grading engine,
 *    never a saved copy: all of it, or only the Midterm, the Finals, or the Final Grade;
 *  - changing the time limit keeps the same link, so one already sent keeps working;
 *  - stopping the share makes the link stop working; sharing again creates a different link;
 *  - removing the student's enrollment removes the link with it.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Class } from '../models/Class.js';
import { Enrollment } from '../models/Enrollment.js';
import { Student, formatFullName } from '../models/Student.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from './audit.service.js';
import { getOwnedClass } from './class.service.js';
import { getStudentSheet } from './grading/grading.service.js';
import { escapeHtml, isMailConfigured, sendMail } from './mail.service.js';

export const MAX_DURATION_HOURS = 24 * 366;
export const MAX_BULK_STUDENTS = 300;
export const SHARE_SCOPES = Object.freeze(['all', 'midterm', 'finals', 'overall']);
const SCOPE_TEXT = { all: 'your Midterm, Finals and Final Grade', midterm: 'your Midterm grade', finals: 'your Finals grade', overall: 'your Final Grade' };
const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester', SUMMER: 'Summer' };
const INVALID_LINK = 'This link is not valid. Ask your instructor for a new one.';
const EXPIRED_LINK = 'This link has expired. Ask your instructor to share your grading sheet again.';

const newToken = () => crypto.randomBytes(18).toString('base64url'); // 24 chars, unguessable
const isExpired = (share, now = new Date()) => Boolean(share?.expiresAt && share.expiresAt <= now);

function toPublicShare(enrollment) {
  const share = enrollment.gradeShare;
  if (!share?.token) return null;
  return { token: share.token, scope: share.scope ?? 'all', expiresAt: share.expiresAt ?? null, sharedAt: share.sharedAt ?? null, emailedAt: share.emailedAt ?? null, expired: isExpired(share) };
}

/** The class (owned by this instructor), the student's enrollment in it, and the student. */
async function load(instructorId, classId, studentId) {
  const cls = await getOwnedClass(instructorId, classId);
  if (!mongoose.isValidObjectId(studentId)) throw ApiError.notFound('This student is not in this class.');
  const [enrollment, student] = await Promise.all([
    Enrollment.findOne({ class: cls._id, student: studentId }),
    Student.findOne({ _id: studentId, instructor: instructorId }),
  ]);
  if (!enrollment || !student) throw ApiError.notFound('This student is not in this class.');
  return { cls, enrollment, student };
}

const describe = (enrollment, student) => ({
  share: toPublicShare(enrollment),
  student: { fullName: formatFullName(student), email: student.email || null },
  emailAvailable: isMailConfigured(),
});

export async function getShare(instructorId, classId, studentId) {
  const { enrollment, student } = await load(instructorId, classId, studentId);
  return describe(enrollment, student);
}

/**
 * Starts sharing, or changes what is shared and for how long. `durationHours` null = no time
 * limit. `scope` is one of SHARE_SCOPES; left out, it stays as it was (everything for a new share).
 */
export async function setShare(instructorId, classId, studentId, durationHours, req, { scope } = {}) {
  const { cls, enrollment, student } = await load(instructorId, classId, studentId);
  const now = new Date();
  const existing = enrollment.gradeShare?.token ? enrollment.gradeShare : null;
  enrollment.gradeShare = {
    token: existing?.token ?? newToken(),
    scope: scope ?? existing?.scope ?? 'all',
    expiresAt: durationHours ? new Date(now.getTime() + durationHours * 3600 * 1000) : null,
    sharedAt: existing?.sharedAt ?? now,
    emailedAt: existing?.emailedAt ?? null,
  };
  await enrollment.save();
  await recordAudit({ userId: instructorId, action: 'GRADE_SHARE_SET', collection: 'enrollments', recordId: student._id, classId: cls._id, metadata: { studentNumber: student.studentNumber, scope: enrollment.gradeShare.scope, durationHours: durationHours ?? null, expiresAt: enrollment.gradeShare.expiresAt }, req });
  return describe(enrollment, student);
}

export async function stopShare(instructorId, classId, studentId, req) {
  const { cls, enrollment, student } = await load(instructorId, classId, studentId);
  if (enrollment.gradeShare?.token) {
    enrollment.gradeShare = { token: null, scope: 'all', expiresAt: null, sharedAt: null, emailedAt: null };
    await enrollment.save();
    await recordAudit({ userId: instructorId, action: 'GRADE_SHARE_STOP', collection: 'enrollments', recordId: student._id, classId: cls._id, metadata: { studentNumber: student.studentNumber }, req });
  }
  return describe(enrollment, student);
}

/** The app's address for links in emails: where the instructor is using it, if that is a known address. */
function clientOrigin(req) {
  const origin = req?.get?.('Origin');
  return origin && env.clientUrls.includes(origin) ? origin : env.clientUrls[0];
}

const formatExpiry = (date) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: env.timezone, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);

/** The email a student receives. Exported for tests. */
export function buildShareEmail({ student, cls, instructorName, url, expiresAt, scope = 'all' }) {
  const shows = `It shows ${SCOPE_TEXT[scope] ?? SCOPE_TEXT.all}: your scores in each part of the grade and how it was computed.`;
  const className = `${cls.subjectCode} · ${cls.section}`;
  const term = `${SEMESTER_LABELS[cls.semester] ?? cls.semester}, SY ${cls.schoolYear}`;
  const from = instructorName ? `Your instructor, ${instructorName},` : 'Your instructor';
  const limit = expiresAt ? `This link works until ${formatExpiry(expiresAt)}.` : 'This link stays open until your instructor closes it.';
  const subject = `Your grading sheet for ${className}`;
  const text = [
    `Hello ${student.firstName},`,
    '',
    `${from} shared your grading sheet for ${className} (${cls.subjectTitle}), ${term}. ${shows}`,
    '',
    `View your grading sheet: ${url}`,
    '',
    limit,
    'This link is only for you. Please do not share it. If you have questions about your grade, talk to your instructor.',
    '',
    'Gradify · Eastern Visayas State University',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f7f0e8;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#2b1d1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f0e8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#8a1218;border-bottom:4px solid #f0b738;padding:22px 28px;">
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#f6d488;">Gradify · EVSU</div>
<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">Your grading sheet</div>
</td></tr>
<tr><td style="padding:26px 28px 8px;font-size:15px;line-height:1.6;">
<p style="margin:0 0 14px;">Hello ${escapeHtml(student.firstName)},</p>
<p style="margin:0 0 18px;">${escapeHtml(from)} shared your grading sheet for this class. ${escapeHtml(shows)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6ef;border:1px solid #eadfd2;border-radius:12px;"><tr><td style="padding:14px 16px;">
<div style="font-size:17px;font-weight:700;color:#8a1218;">${escapeHtml(className)}</div>
<div style="font-size:14px;">${escapeHtml(cls.subjectTitle)}</div>
<div style="font-size:13px;color:#7a6a63;margin-top:2px;">${escapeHtml(term)}</div>
</td></tr></table>
<p style="margin:24px 0;text-align:center;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#8a1218;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:10px;">View my grading sheet</a></p>
<p style="margin:0 0 10px;font-size:13px;color:#7a6a63;">${escapeHtml(limit)} This link is only for you. Please do not share it.</p>
<p style="margin:0 0 10px;font-size:13px;color:#7a6a63;">If the button does not work, copy this address into your browser:<br><span style="color:#8a1218;word-break:break-all;">${escapeHtml(url)}</span></p>
<p style="margin:0 0 18px;font-size:13px;color:#7a6a63;">If you have questions about your grade, talk to your instructor.</p>
</td></tr>
<tr><td style="padding:14px 28px 20px;border-top:1px solid #eadfd2;font-size:12px;color:#9a8b84;">Gradify · Eastern Visayas State University</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Emails the link to the address on the student's record. The sheet must already be shared. */
export async function emailShare(instructorId, classId, studentId, req) {
  const { cls, enrollment, student } = await load(instructorId, classId, studentId);
  const share = enrollment.gradeShare?.token ? enrollment.gradeShare : null;
  if (!share) throw ApiError.conflict('Share the grading sheet first, then send it.');
  if (isExpired(share)) throw ApiError.conflict('The viewing time has ended. Set a new time limit, then send it.');
  if (!student.email) throw ApiError.conflict('This student has no email address on record. Add one in Students, or copy the link instead.');

  const instructor = await User.findById(instructorId).select('name email').lean();
  await sendShareLink({ cls, enrollment, student, instructor, origin: clientOrigin(req) });
  await recordAudit({ userId: instructorId, action: 'GRADE_SHARE_EMAIL', collection: 'enrollments', recordId: student._id, classId: cls._id, metadata: { studentNumber: student.studentNumber }, req });
  return describe(enrollment, student);
}

/** Sends one student their link and notes when. Throws the mail service's user-safe error on failure. */
async function sendShareLink({ cls, enrollment, student, instructor, origin }) {
  const share = enrollment.gradeShare;
  await sendMail({
    to: student.email,
    replyTo: instructor?.email || undefined,
    ...buildShareEmail({ student, cls, instructorName: instructor?.name ?? null, url: `${origin}/my-grades/${share.token}`, expiresAt: share.expiresAt, scope: share.scope ?? 'all' }),
  });
  enrollment.gradeShare.emailedAt = new Date();
  await enrollment.save();
}

/* ───────── Several students at once (from the class grading sheet) ───────── */

/** The class and, for each chosen student who is in it, their enrollment and record. Others are ignored. */
async function loadMany(instructorId, classId, studentIds) {
  const cls = await getOwnedClass(instructorId, classId);
  const ids = [...new Set(studentIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const [enrollments, students] = await Promise.all([
    Enrollment.find({ class: cls._id, student: { $in: ids } }),
    Student.find({ _id: { $in: ids }, instructor: instructorId }),
  ]);
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));
  const pairs = enrollments
    .map((enrollment) => ({ enrollment, student: studentById.get(enrollment.student.toString()) }))
    .filter((pair) => pair.student);
  if (!pairs.length) throw ApiError.notFound('None of the selected students are in this class.');
  return { cls, pairs };
}

/**
 * Shares each selected student's own sheet with them (each gets their own private link), with the
 * same choices as for one student. With `email`, each link is also sent to the address on the
 * student's record; students without one, and emails that fail, are reported by name and stay shared.
 */
export async function setShareMany(instructorId, classId, studentIds, { durationHours = null, scope, email = false } = {}, req) {
  const { cls, pairs } = await loadMany(instructorId, classId, studentIds);
  const now = new Date();
  const expiresAt = durationHours ? new Date(now.getTime() + durationHours * 3600 * 1000) : null;
  for (const { enrollment } of pairs) {
    const existing = enrollment.gradeShare?.token ? enrollment.gradeShare : null;
    enrollment.gradeShare = { token: existing?.token ?? newToken(), scope: scope ?? existing?.scope ?? 'all', expiresAt, sharedAt: existing?.sharedAt ?? now, emailedAt: existing?.emailedAt ?? null };
    await enrollment.save();
  }

  const result = { shared: pairs.length, expiresAt, emailRequested: Boolean(email), emailAvailable: isMailConfigured(), emailed: 0, noEmail: [], emailFailed: [] };
  if (email && result.emailAvailable) {
    const instructor = await User.findById(instructorId).select('name email').lean();
    const origin = clientOrigin(req);
    const queue = pairs.filter(({ student }) => {
      if (!student.email) result.noEmail.push(formatFullName(student));
      return Boolean(student.email);
    });
    // A few at a time: quick for a whole class without flooding the mail server.
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await sendShareLink({ cls, ...next, instructor, origin });
          result.emailed += 1;
        } catch {
          result.emailFailed.push(formatFullName(next.student)); // the cause is already logged by the mail service
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    result.noEmail.sort();
    result.emailFailed.sort();
  }

  await recordAudit({ userId: instructorId, action: 'GRADE_SHARE_SET_BULK', collection: 'enrollments', classId: cls._id, metadata: { students: pairs.length, scope: scope ?? null, durationHours: durationHours ?? null, expiresAt, emailed: result.emailed, emailFailed: result.emailFailed.length }, req });
  return result;
}

export async function stopShareMany(instructorId, classId, studentIds, req) {
  const { cls, pairs } = await loadMany(instructorId, classId, studentIds);
  let stopped = 0;
  for (const { enrollment } of pairs) {
    if (!enrollment.gradeShare?.token) continue;
    enrollment.gradeShare = { token: null, scope: 'all', expiresAt: null, sharedAt: null, emailedAt: null };
    await enrollment.save();
    stopped += 1;
  }
  if (stopped) await recordAudit({ userId: instructorId, action: 'GRADE_SHARE_STOP_BULK', collection: 'enrollments', classId: cls._id, metadata: { students: stopped }, req });
  return { stopped };
}

/* ───────── The student's page (no sign-in) ───────── */

export async function getSharedSheet(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw ApiError.notFound(INVALID_LINK);
  const enrollment = await Enrollment.findOne({ 'gradeShare.token': token }).lean();
  if (!enrollment) throw ApiError.notFound(INVALID_LINK);
  if (isExpired(enrollment.gradeShare)) throw new ApiError(410, 'LINK_EXPIRED', EXPIRED_LINK);
  const cls = await Class.findById(enrollment.class).lean();
  if (!cls) throw ApiError.notFound(INVALID_LINK);
  const sheet = await getStudentSheet(cls, enrollment.student);
  if (!sheet) throw ApiError.notFound('Your grading sheet is not ready yet. Ask your instructor.');
  const instructor = await User.findById(cls.instructor).select('name').lean();
  // Only the shared part leaves the server. The Final Grade always carries its two period breakdowns,
  // because that is how it is computed.
  const scope = enrollment.gradeShare.scope ?? 'all';
  const grades = scope === 'all' ? sheet.grades : { [scope]: sheet.grades[scope] };
  return { ...sheet, grades, scope, instructor: instructor?.name ?? null, expiresAt: enrollment.gradeShare.expiresAt ?? null };
}
