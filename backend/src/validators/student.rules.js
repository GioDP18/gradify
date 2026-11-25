import { STUDENT_STATUSES } from '../models/Student.js';
import { squish } from '../utils/strings.js';

/**
 * Single source of truth for student field validation. Used by the JSON API
 * (create/update) and by CSV import, so both apply identical rules.
 */
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M} .'’-]*$/u;
const STUDENT_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const FIELDS = {
  studentNumber: {
    required: true,
    normalize: (v) => squish(v).toUpperCase().replace(/\s/g, ''),
    check: (v) => STUDENT_NUMBER_PATTERN.test(v) || 'Student number must be 3–20 letters, numbers, or dashes',
  },
  firstName: {
    required: true,
    normalize: squish,
    check: (v) => (v.length <= 60 && NAME_PATTERN.test(v)) || 'First name may contain letters, spaces, apostrophes, dots, and dashes (max 60)',
  },
  middleName: {
    required: false,
    normalize: squish,
    check: (v) => (v.length <= 60 && NAME_PATTERN.test(v)) || 'Middle name may contain letters, spaces, apostrophes, dots, and dashes (max 60)',
  },
  lastName: {
    required: true,
    normalize: squish,
    check: (v) => (v.length <= 60 && NAME_PATTERN.test(v)) || 'Last name may contain letters, spaces, apostrophes, dots, and dashes (max 60)',
  },
  email: {
    required: false,
    normalize: (v) => squish(v).toLowerCase(),
    check: (v) => (v.length <= 254 && EMAIL_PATTERN.test(v)) || 'Email address is invalid',
  },
  course: {
    required: true,
    normalize: (v) => squish(v).toUpperCase(),
    check: (v) => v.length <= 60 || 'Course must be at most 60 characters',
  },
  yearLevel: {
    required: true,
    normalize: (v) => (typeof v === 'number' ? v : Number(String(v).trim())),
    check: (v) => (Number.isInteger(v) && v >= 1 && v <= 6) || 'Year level must be a whole number from 1 to 6',
  },
  section: {
    required: true,
    normalize: (v) => squish(v).toUpperCase(),
    check: (v) => v.length <= 30 || 'Section must be at most 30 characters',
  },
  enrollmentStatus: {
    required: false,
    normalize: (v) => squish(v).toUpperCase(),
    check: (v) => STUDENT_STATUSES.includes(v) || 'Choose a valid status.',
  },
};

export const STUDENT_FIELDS = Object.keys(FIELDS);

const LABELS = {
  studentNumber: 'Student number',
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  email: 'Email',
  course: 'Course',
  yearLevel: 'Year level',
  section: 'Section',
  enrollmentStatus: 'Status',
};

/**
 * Validates and normalizes student input.
 * @param {object} input raw values
 * @param {{ partial?: boolean }} options partial=true for updates (only provided fields are checked)
 * @returns {{ value: object, errors: {field: string, message: string}[] }}
 */
export function validateStudentInput(input, { partial = false } = {}) {
  const value = {};
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};

  for (const [field, rule] of Object.entries(FIELDS)) {
    const provided = Object.prototype.hasOwnProperty.call(source, field);
    if (partial && !provided) continue;
    const raw = source[field];

    if (raw !== undefined && raw !== null && typeof raw === 'object') {
      errors.push({ field, message: `${LABELS[field]} is not valid` });
      continue;
    }
    if (isBlank(raw)) {
      if (rule.required) errors.push({ field, message: `${LABELS[field]} is required` });
      else value[field] = field === 'enrollmentStatus' ? (partial ? undefined : 'ENROLLED') : null;
      if (value[field] === undefined) delete value[field];
      continue;
    }
    const normalized = rule.normalize(raw);
    const result = rule.check(normalized);
    if (result !== true) errors.push({ field, message: result });
    else value[field] = normalized;
  }
  return { value, errors };
}
