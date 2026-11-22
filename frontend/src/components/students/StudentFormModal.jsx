import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import Modal from '../common/Modal';
import Spinner from '../common/Spinner';
import { TextField, SelectField, applyServerErrors } from '../common/FormField';
import { formatClassLabel } from '../../context/ClassContext';

export const STUDENT_STATUS_OPTIONS = [
  { value: 'ENROLLED', label: 'Enrolled' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'INACTIVE', label: 'Inactive' },
];
const YEAR_OPTIONS = [1, 2, 3, 4, 5, 6].map((y) => ({ value: String(y), label: `Year ${y}` }));
const FIELDS = ['studentNumber', 'firstName', 'middleName', 'lastName', 'email', 'course', 'yearLevel', 'section', 'enrollmentStatus'];
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M} .'’-]*$/u;

const EMPTY = { studentNumber: '', firstName: '', middleName: '', lastName: '', email: '', course: '', yearLevel: '', section: '', enrollmentStatus: 'ENROLLED' };

function toFormValues(student) {
  if (!student) return EMPTY;
  return Object.fromEntries(FIELDS.map((f) => [f, student[f] === null || student[f] === undefined ? '' : String(student[f])]));
}

const nameRules = (label, required) => ({
  validate: (v) => {
    const value = v.trim();
    if (!value) return required ? `${label} is required.` : true;
    if (value.length > 60) return 'At most 60 characters.';
    return NAME_PATTERN.test(value) || 'Letters, spaces, apostrophes, dots, and dashes only.';
  },
});

/**
 * Create / edit a student. The backend applies the authoritative validation
 * (the same rules as CSV import); field errors it returns are shown inline.
 */
export default function StudentFormModal({ open, student, activeClass, onClose, onSubmit }) {
  const isEdit = Boolean(student);
  const [formError, setFormError] = useState(null);
  const [enrollInClass, setEnrollInClass] = useState(true);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ defaultValues: toFormValues(student) });

  useEffect(() => {
    if (open) {
      reset(toFormValues(student));
      setFormError(null);
      setEnrollInClass(true);
    }
  }, [open, student, reset]);

  const submit = async (values) => {
    setFormError(null);
    const data = { ...values, yearLevel: Number(values.yearLevel) };
    try {
      await onSubmit(data, { classId: !isEdit && enrollInClass && activeClass ? activeClass.id : undefined });
    } catch (error) {
      if (!applyServerErrors(error, setError, FIELDS)) setFormError(error.message);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    if (isDirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      size="lg"
      title={isEdit ? 'Edit student' : 'Add student'}
      onClose={handleClose}
      closeDisabled={isSubmitting}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={handleClose} disabled={isSubmitting}>Cancel</button>
          <button type="submit" form="student-form" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" label="" className="me-2" />}
            {isEdit ? 'Save changes' : 'Add student'}
          </button>
        </>
      }
    >
      <form id="student-form" onSubmit={handleSubmit(submit)} noValidate>
        {formError && <div className="alert alert-danger py-2 small" role="alert">{formError}</div>}
        <div className="row gx-3">
          <div className="col-md-6">
            <TextField
              label="Student number"
              required
              placeholder="2026-00123"
              error={errors.studentNumber?.message}
              {...register('studentNumber', {
                validate: (v) => /^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(v.trim()) || '3–20 letters, numbers, or dashes.',
              })}
            />
          </div>
          <div className="col-md-6">
            <TextField label="Email" type="email" placeholder="Optional" error={errors.email?.message}
              {...register('email', { validate: (v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Enter a valid email address.' })} />
          </div>
          <div className="col-md-4">
            <TextField label="Last name" required error={errors.lastName?.message} {...register('lastName', nameRules('Last name', true))} />
          </div>
          <div className="col-md-4">
            <TextField label="First name" required error={errors.firstName?.message} {...register('firstName', nameRules('First name', true))} />
          </div>
          <div className="col-md-4">
            <TextField label="Middle name" error={errors.middleName?.message} {...register('middleName', nameRules('Middle name', false))} />
          </div>
          <div className="col-md-4">
            <TextField label="Course" required placeholder="BSIT" error={errors.course?.message}
              {...register('course', { validate: (v) => (v.trim() ? v.trim().length <= 60 || 'At most 60 characters.' : 'Course is required.') })} />
          </div>
          <div className="col-md-4">
            <SelectField label="Year level" required placeholder="Select year" options={YEAR_OPTIONS} error={errors.yearLevel?.message}
              {...register('yearLevel', { required: 'Select a year level.' })} />
          </div>
          <div className="col-md-4">
            <TextField label="Section" required placeholder="A" error={errors.section?.message}
              {...register('section', { validate: (v) => (v.trim() ? v.trim().length <= 30 || 'At most 30 characters.' : 'Section is required.') })} />
          </div>
          <div className="col-md-6">
            <SelectField label="Enrollment status" options={STUDENT_STATUS_OPTIONS} error={errors.enrollmentStatus?.message}
              hint="Status at the university. Dropping a student from one class is done from the class roster."
              {...register('enrollmentStatus')} />
          </div>
        </div>
        {!isEdit && activeClass && (
          <div className="form-check">
            <input id="enroll-in-class" type="checkbox" className="form-check-input" checked={enrollInClass} onChange={(e) => setEnrollInClass(e.target.checked)} />
            <label htmlFor="enroll-in-class" className="form-check-label">
              Also enroll in my working class <strong>{formatClassLabel(activeClass)}</strong>
            </label>
          </div>
        )}
      </form>
    </Modal>
  );
}
