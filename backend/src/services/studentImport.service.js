import { parse } from 'csv-parse/sync';
import { Student } from '../models/Student.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { runInTransaction } from '../utils/transaction.js';
import { validateStudentInput, STUDENT_FIELDS } from '../validators/student.rules.js';
import { recordAudit } from './audit.service.js';
import { getOwnedClass } from './class.service.js';
import { enrollStudentIds } from './enrollment.service.js';
import { CLASS_STATUSES } from '../models/Class.js';

export const MAX_IMPORT_ROWS = 2000;

/** Accepted header spellings (compared after lowercasing and removing non-alphanumerics). */
const HEADER_ALIASES = {
  studentNumber: ['studentnumber', 'studentno', 'studentid', 'idnumber', 'idno'],
  firstName: ['firstname', 'givenname'],
  middleName: ['middlename', 'middleinitial', 'mi'],
  lastName: ['lastname', 'surname', 'familyname'],
  email: ['email', 'emailaddress'],
  course: ['course', 'program', 'degreeprogram'],
  yearLevel: ['yearlevel', 'year', 'yr'],
  section: ['section'],
  enrollmentStatus: ['enrollmentstatus', 'status'],
};
const REQUIRED_COLUMNS = ['studentNumber', 'firstName', 'lastName', 'course', 'yearLevel', 'section'];

const canonical = (header) => String(header).toLowerCase().replace(/[^a-z0-9]/g, '');

function mapHeaders(headers) {
  const mapping = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((h) => aliases.includes(canonical(h)));
    if (index !== -1) mapping[field] = index;
  }
  return mapping;
}

function parseCsv(buffer) {
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, info: true, trim: true });
  } catch (error) {
    // The parser's own message stays in the log; the user gets the line to look at.
    logger.warn('CSV import could not be parsed:', error.code, error.message);
    throw ApiError.badRequest(error.lines ? `This file is not a valid CSV. Check line ${error.lines}.` : 'This file is not a valid CSV.');
  }
  if (records.length === 0) throw ApiError.badRequest('The CSV file is empty');

  const [headerRecord, ...dataRecords] = records;
  const mapping = mapHeaders(headerRecord.record);
  const missing = REQUIRED_COLUMNS.filter((field) => mapping[field] === undefined);
  if (missing.length) {
    throw ApiError.validation(
      missing.map((field) => ({ field, message: `Missing required column "${field}"` })),
      'The CSV file is missing required columns',
    );
  }
  if (dataRecords.length === 0) throw ApiError.badRequest('The CSV file has a header but no student rows');
  if (dataRecords.length > MAX_IMPORT_ROWS) throw ApiError.badRequest(`A single import can contain at most ${MAX_IMPORT_ROWS} students`);

  return dataRecords.map(({ record, info }) => {
    const input = {};
    for (const field of STUDENT_FIELDS) {
      if (mapping[field] !== undefined) input[field] = record[mapping[field]] ?? '';
    }
    return { line: info.lines, input };
  });
}

/**
 * Imports students from CSV.
 *  - dryRun: validate only and report what would happen.
 *  - Without skipInvalid, any invalid row aborts the whole import (nothing is written).
 *  - With classId, new and already-existing students (matched by student number) are enrolled.
 * Row numbers in the report are the line numbers in the file (header = line 1).
 */
export async function importStudents(instructorId, buffer, { classId, dryRun = false, skipInvalid = false } = {}, req) {
  if (classId) {
    const cls = await getOwnedClass(instructorId, classId);
    if (cls.status !== CLASS_STATUSES.ACTIVE) throw ApiError.conflict('This class is archived. Restore it before importing students into it.');
  }
  const rows = parseCsv(buffer);

  const seen = new Map();
  const validated = rows.map(({ line, input }) => {
    const { value, errors } = validateStudentInput(input);
    const number = value.studentNumber ?? (typeof input.studentNumber === 'string' ? input.studentNumber.trim() : '');
    if (value.studentNumber) {
      if (seen.has(value.studentNumber)) {
        errors.push({ field: 'studentNumber', message: `Duplicate of line ${seen.get(value.studentNumber)} in this file` });
      } else seen.set(value.studentNumber, line);
    }
    return { line, studentNumber: number, value, errors };
  });

  const numbers = validated.filter((r) => r.errors.length === 0).map((r) => r.value.studentNumber);
  const existing = await Student.find({ instructor: instructorId, studentNumber: { $in: numbers } }).lean();
  const existingByNumber = new Map(existing.map((s) => [s.studentNumber, s]));

  const report = { dryRun, totalRows: rows.length, toCreate: 0, toEnrollExisting: 0, errors: [], warnings: [] };
  const createRows = [];
  const enrollExistingIds = [];

  for (const row of validated) {
    if (row.errors.length) {
      report.errors.push({ row: row.line, studentNumber: row.studentNumber || null, errors: row.errors });
      continue;
    }
    const match = existingByNumber.get(row.value.studentNumber);
    if (!match) {
      createRows.push(row);
      continue;
    }
    if (!classId) {
      report.errors.push({ row: row.line, studentNumber: row.value.studentNumber, errors: [{ field: 'studentNumber', message: 'Already in your roster' }] });
    } else if (match.archivedAt) {
      report.errors.push({ row: row.line, studentNumber: row.value.studentNumber, errors: [{ field: 'studentNumber', message: 'Matches an archived student; restore them first' }] });
    } else {
      enrollExistingIds.push(match._id);
      if (match.lastName.toLowerCase() !== row.value.lastName.toLowerCase()) {
        report.warnings.push({ row: row.line, studentNumber: row.value.studentNumber, message: `Existing record has last name "${match.lastName}"; the existing record will be enrolled unchanged` });
      }
    }
  }
  report.toCreate = createRows.length;
  report.toEnrollExisting = enrollExistingIds.length;
  report.invalidRows = report.errors.length;

  if (dryRun) return report;
  if (report.errors.length && !skipInvalid) {
    throw ApiError.validation(report.errors.map((e) => ({ field: `row ${e.row}`, message: e.errors.map((x) => x.message).join('; ') })), 'Some rows are invalid. Fix them or choose to skip invalid rows.');
  }
  if (createRows.length === 0 && enrollExistingIds.length === 0) {
    throw ApiError.badRequest('There are no valid rows to import');
  }

  const created = await runInTransaction(async (session) => {
    const docs = createRows.length
      ? await Student.insertMany(createRows.map((r) => ({ ...r.value, instructor: instructorId })), { session })
      : [];
    if (classId) {
      await enrollStudentIds(instructorId, classId, [...docs.map((d) => d._id), ...enrollExistingIds], req, { session });
    }
    await recordAudit(
      {
        userId: instructorId,
        action: 'STUDENT_IMPORT',
        collection: 'students',
        classId,
        newValue: { created: docs.length, enrolledExisting: enrollExistingIds.length, skippedRows: report.errors.length, studentNumbers: docs.map((d) => d.studentNumber) },
        req,
      },
      { session },
    );
    return docs.length;
  });

  return { ...report, created, enrolledExisting: enrollExistingIds.length, skipped: report.errors.length };
}
