import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import Modal from '../common/Modal';
import Spinner from '../common/Spinner';
import { TextField, SelectField, applyServerErrors } from '../common/FormField';
import { GRADING_PERIODS } from '../common/GradingPeriodSelector';
import { todayDateOnly } from '../../utils/format';

const STATUS_OPTIONS = [
  { value: 'PUBLISHED', label: 'Published — counts toward grades' },
  { value: 'DRAFT', label: 'Draft — not counted yet' },
];
const FIELDS = ['title', 'description', 'instructions', 'period', 'date', 'maxScore', 'status'];

function toValues(item, defaultPeriod) {
  if (!item) return { title: '', description: '', instructions: '', period: defaultPeriod, date: todayDateOnly(), maxScore: '', status: 'PUBLISHED' };
  return {
    title: item.title,
    description: item.description ?? '',
    instructions: item.instructions ?? '',
    period: item.period,
    date: item.date,
    maxScore: String(item.maxScore),
    status: item.status,
  };
}

/** Create / edit a quiz, activity, or examination. */
export default function AssessmentFormModal({ open, type, item, defaultPeriod, hasScores, onClose, onSubmit }) {
  const isEdit = Boolean(item);
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm();

  useEffect(() => {
    if (open) {
      reset(toValues(item, defaultPeriod));
      setFormError(null);
    }
  }, [open, item, defaultPeriod, reset]);

  const submit = async (values) => {
    setFormError(null);
    const data = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      instructions: values.instructions.trim() || null,
      date: values.date,
      maxScore: Number(values.maxScore),
      status: values.status,
    };
    if (!isEdit || !hasScores) data.period = values.period;
    try {
      await onSubmit(data);
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
      title={isEdit ? `Edit ${type.singular}` : `New ${type.singular}`}
      onClose={handleClose}
      closeDisabled={isSubmitting}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={handleClose} disabled={isSubmitting}>Cancel</button>
          <button type="submit" form="assessment-form" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" label="" className="me-2" />}
            {isEdit ? 'Save changes' : `Create ${type.singular}`}
          </button>
        </>
      }
    >
      <form id="assessment-form" onSubmit={handleSubmit(submit)} noValidate>
        {formError && <div className="alert alert-danger py-2 small" role="alert">{formError}</div>}
        <TextField label="Title" required error={errors.title?.message}
          {...register('title', { validate: (v) => (v.trim() ? v.trim().length <= 150 || 'At most 150 characters.' : 'Title is required.') })} />
        <div className="row gx-3">
          <div className="col-sm-4">
            <SelectField label="Grading period" required options={GRADING_PERIODS} disabled={isEdit && hasScores}
              hint={isEdit && hasScores ? 'Locked because scores have been entered.' : undefined}
              error={errors.period?.message} {...register('period', { required: 'Choose a grading period.' })} />
          </div>
          <div className="col-sm-4">
            <TextField label="Date" type="date" required error={errors.date?.message} {...register('date', { required: 'Choose a date.' })} />
          </div>
          <div className="col-sm-4">
            <TextField label="Total possible score" type="text" inputMode="decimal" required placeholder="e.g. 50" error={errors.maxScore?.message}
              {...register('maxScore', {
                validate: (v) => {
                  if (!String(v).trim()) return 'Total possible score is required.';
                  if (!/^\d+(\.\d{1,2})?$/.test(String(v).trim())) return 'Use a number with at most 2 decimals.';
                  const n = Number(v);
                  if (n <= 0) return 'Must be greater than zero.';
                  if (n > 10000) return 'At most 10,000.';
                  return true;
                },
              })} />
          </div>
        </div>
        <SelectField label="Status" options={STATUS_OPTIONS} error={errors.status?.message} {...register('status')} />
        <div className="mb-3">
          <label htmlFor="assessment-description" className="form-label">Description</label>
          <textarea id="assessment-description" className="form-control" rows={2} maxLength={1000} placeholder="Optional" {...register('description')} />
        </div>
        <div className="mb-1">
          <label htmlFor="assessment-instructions" className="form-label">Instructions</label>
          <textarea id="assessment-instructions" className="form-control" rows={2} maxLength={2000} placeholder="Optional" {...register('instructions')} />
        </div>
        <p className="small text-muted-evsu mt-2 mb-0">
          Scores count toward the <strong>{type.component}</strong> component of the selected period when the {type.singular} is published.
        </p>
      </form>
    </Modal>
  );
}
