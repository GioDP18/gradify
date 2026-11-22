import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import Modal from '../common/Modal';
import Spinner from '../common/Spinner';
import { TextField, SelectField, applyServerErrors } from '../common/FormField';
import { SEMESTER_LABELS } from '../../context/ClassContext';

const SEMESTER_OPTIONS = Object.entries(SEMESTER_LABELS).map(([value, label]) => ({ value, label }));
const FIELDS = ['subjectCode', 'subjectTitle', 'section', 'schoolYear', 'semester', 'termEndDate'];

function defaultSchoolYear(today = new Date()) {
  // Philippine school years start around August.
  const start = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

function toFormValues(cls) {
  if (!cls) {
    return { subjectCode: '', subjectTitle: '', section: '', schoolYear: defaultSchoolYear(), semester: '', termEndDate: '' };
  }
  return {
    subjectCode: cls.subjectCode,
    subjectTitle: cls.subjectTitle,
    section: cls.section,
    schoolYear: cls.schoolYear,
    semester: cls.semester,
    termEndDate: cls.termEndDate ? cls.termEndDate.slice(0, 10) : '',
  };
}

/** Create or edit a class. Validation mirrors the API; the API remains the authority. */
export default function ClassFormModal({ open, initialClass, onClose, onSubmit }) {
  const isEdit = Boolean(initialClass);
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ defaultValues: toFormValues(initialClass) });

  useEffect(() => {
    if (open) {
      reset(toFormValues(initialClass));
      setFormError(null);
    }
  }, [open, initialClass, reset]);

  const submit = async (values) => {
    setFormError(null);
    try {
      await onSubmit({ ...values, subjectCode: values.subjectCode.trim(), section: values.section.trim(), subjectTitle: values.subjectTitle.trim() });
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
      title={isEdit ? 'Edit class' : 'New class'}
      onClose={handleClose}
      closeDisabled={isSubmitting}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={handleClose} disabled={isSubmitting}>Cancel</button>
          <button type="submit" form="class-form" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" label="" className="me-2" />}
            {isEdit ? 'Save changes' : 'Create class'}
          </button>
        </>
      }
    >
      <form id="class-form" onSubmit={handleSubmit(submit)} noValidate>
        {formError && <div className="alert alert-danger py-2 small" role="alert">{formError}</div>}
        <div className="row gx-3">
          <div className="col-sm-5">
            <TextField
              label="Subject code"
              required
              placeholder="IT 101"
              error={errors.subjectCode?.message}
              {...register('subjectCode', {
                validate: (v) => v.trim().length > 0 || 'Subject code is required.',
                maxLength: { value: 20, message: 'At most 20 characters.' },
                pattern: { value: /^[A-Za-z0-9 .-]+$/, message: 'Letters, numbers, spaces, dots, and dashes only.' },
              })}
            />
          </div>
          <div className="col-sm-7">
            <TextField
              label="Section"
              required
              placeholder="BSIT-1A"
              error={errors.section?.message}
              {...register('section', {
                validate: (v) => v.trim().length > 0 || 'Section is required.',
                maxLength: { value: 30, message: 'At most 30 characters.' },
              })}
            />
          </div>
        </div>
        <TextField
          label="Subject title"
          required
          placeholder="Introduction to Computing"
          error={errors.subjectTitle?.message}
          {...register('subjectTitle', {
            validate: (v) => v.trim().length > 0 || 'Subject title is required.',
            maxLength: { value: 150, message: 'At most 150 characters.' },
          })}
        />
        <div className="row">
          <div className="col-sm-6">
            <TextField
              label="School year"
              required
              placeholder="2026-2027"
              error={errors.schoolYear?.message}
              {...register('schoolYear', {
                validate: (v) => {
                  const m = /^(\d{4})-(\d{4})$/.exec(v.trim());
                  return (m && Number(m[2]) === Number(m[1]) + 1) || 'Use the format 2026-2027.';
                },
              })}
            />
          </div>
          <div className="col-sm-6">
            <SelectField
              label="Semester"
              required
              placeholder="Select semester"
              options={SEMESTER_OPTIONS}
              error={errors.semester?.message}
              {...register('semester', { required: 'Select a semester.' })}
            />
          </div>
        </div>
        <TextField
          label="Term end date"
          type="date"
          required
          hint="Used for INC deadlines: an INC not completed within one year after this date becomes 5.0."
          error={errors.termEndDate?.message}
          {...register('termEndDate', { required: 'Term end date is required.' })}
        />
      </form>
    </Modal>
  );
}
