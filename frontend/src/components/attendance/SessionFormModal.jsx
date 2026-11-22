import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import Modal from '../common/Modal';
import Spinner from '../common/Spinner';
import { TextField, SelectField, applyServerErrors } from '../common/FormField';
import { GRADING_PERIODS } from '../common/GradingPeriodSelector';
import { todayDateOnly } from '../../utils/format';

/** Create (date + period + description) or edit (date + description; period locked) a session. */
export default function SessionFormModal({ open, session, defaultPeriod, classLabel, studentCount, onClose, onSubmit }) {
  const isEdit = Boolean(session);
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(
      isEdit
        ? { sessionDate: session.sessionDate, period: session.period, description: session.description ?? '' }
        : { sessionDate: todayDateOnly(), period: defaultPeriod, description: '' },
    );
  }, [open, isEdit, session, defaultPeriod, reset]);

  const submit = async (values) => {
    setFormError(null);
    const data = { sessionDate: values.sessionDate, description: values.description.trim() || null };
    if (!isEdit) data.period = values.period;
    try {
      await onSubmit(data);
    } catch (error) {
      if (!applyServerErrors(error, setError, ['sessionDate', 'period', 'description'])) setFormError(error.message);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit attendance session' : 'New attendance session'}
      onClose={onClose}
      closeDisabled={isSubmitting}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={isSubmitting}>Cancel</button>
          <button type="submit" form="session-form" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting && <Spinner size="sm" label="" className="me-2" />}
            {isEdit ? 'Save changes' : 'Create and take attendance'}
          </button>
        </>
      }
    >
      <form id="session-form" onSubmit={handleSubmit(submit)} noValidate>
        {formError && <div className="alert alert-danger py-2 small" role="alert">{formError}</div>}
        <div className="row gx-3">
          <div className="col-sm-6">
            <TextField
              label="Date"
              type="date"
              required
              max={todayDateOnly()}
              error={errors.sessionDate?.message}
              {...register('sessionDate', {
                required: 'Choose the session date.',
                validate: (v) => v <= todayDateOnly() || 'Attendance cannot be recorded for a future date.',
              })}
            />
          </div>
          <div className="col-sm-6">
            <SelectField
              label="Grading period"
              required
              options={GRADING_PERIODS}
              disabled={isEdit}
              hint={isEdit ? 'Locked once attendance is recorded.' : undefined}
              error={errors.period?.message}
              {...register('period', { required: 'Choose a grading period.' })}
            />
          </div>
        </div>
        <TextField label="Description" placeholder="Optional, e.g. Lecture 5 or Laboratory" maxLength={300} error={errors.description?.message} {...register('description')} />
        {!isEdit && (
          <p className="small text-muted-evsu mb-0">
            All {studentCount !== undefined ? <strong>{studentCount}</strong> : ''} students currently enrolled in <strong>{classLabel}</strong> will
            start as <strong>Present</strong>. You only need to mark who is absent or excused.
          </p>
        )}
      </form>
    </Modal>
  );
}
