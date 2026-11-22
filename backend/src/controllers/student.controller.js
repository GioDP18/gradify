import * as studentService from '../services/student.service.js';
import { importStudents } from '../services/studentImport.service.js';
import { sendSuccess } from '../utils/response.js';
import { toCsv, sendCsv, dateStamp } from '../utils/csv.js';

export async function list(req, res) {
  const { items, meta } = await studentService.listStudents(req.user.id, req.validatedQuery);
  return sendSuccess(res, items, { meta });
}

export async function facets(req, res) {
  return sendSuccess(res, await studentService.getFacets(req.user.id));
}

export async function get(req, res) {
  return sendSuccess(res, await studentService.getStudentDetail(req.user.id, req.params.id));
}

// Student fields are validated by the shared rules in the service (same rules as CSV import).
export async function create(req, res) {
  const student = await studentService.createStudent(req.user.id, req.rawBody, { classId: req.validatedQuery.classId }, req);
  return sendSuccess(res, student, { status: 201 });
}

export async function update(req, res) {
  return sendSuccess(res, await studentService.updateStudent(req.user.id, req.params.id, req.rawBody, req));
}

export async function archive(req, res) {
  return sendSuccess(res, await studentService.setStudentArchived(req.user.id, req.params.id, true, req));
}

export async function restore(req, res) {
  return sendSuccess(res, await studentService.setStudentArchived(req.user.id, req.params.id, false, req));
}

const EXPORT_COLUMNS = [
  { label: 'Student Number', key: 'studentNumber' },
  { label: 'Last Name', key: 'lastName' },
  { label: 'First Name', key: 'firstName' },
  { label: 'Middle Name', key: 'middleName' },
  { label: 'Email', key: 'email' },
  { label: 'Course', key: 'course' },
  { label: 'Year Level', key: 'yearLevel' },
  { label: 'Section', key: 'section' },
  { label: 'Status', key: 'enrollmentStatus' },
];

export async function exportCsv(req, res) {
  const query = req.validatedQuery;
  const students = await studentService.findStudentsForExport(req.user.id, query);
  const columns = query.classId
    ? [...EXPORT_COLUMNS, { label: 'Class Enrollment', value: (s) => (s.enrollment?.status === 'DROPPED' ? 'DRP' : s.enrollment?.status) }]
    : EXPORT_COLUMNS;
  return sendCsv(res, `evsu-students-${dateStamp()}.csv`, toCsv(columns, students));
}

export async function importCsv(req, res) {
  const report = await importStudents(req.user.id, req.file.buffer, req.validatedQuery, req);
  return sendSuccess(res, report, { status: report.dryRun ? 200 : 201 });
}
