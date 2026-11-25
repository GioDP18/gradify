import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, CircleAlert, CircleCheck, Info, Lock, TriangleAlert, UserRound } from 'lucide-react';
import { TextField, SelectField, applyServerErrors } from '../../components/common/FormField';
import Spinner from '../../components/common/Spinner';
import { SEMESTER_LABELS } from '../../context/ClassContext';
import * as publicApi from '../../services/publicApi';
import logo from '../../assets/brand/gradify-logo-clear.webp';
import campus from '../../assets/brand/evsu-campus-photo.webp';
import './join.css';

const YEAR_OPTIONS = [1, 2, 3, 4, 5, 6].map((y) => ({ value: String(y), label: `Year ${y}` }));
const FIELDS = ['studentNumber', 'lastName', 'firstName', 'middleName', 'email', 'course', 'yearLevel', 'section'];

function Shell({ children }) {
  return (
    <div className="evsu-join">
      {/* Backdrop: the campus in EVSU maroon, curving into the page with a gold ribbon (as on the sign-in page). */}
      <div className="evsu-join__hero" aria-hidden="true">
        <img src={campus} alt="" className="evsu-join__photo" width="1800" height="1011" />
        <svg className="evsu-join__wave" viewBox="0 0 1440 120" preserveAspectRatio="none" focusable="false">
          <path d="M0 70 C360 128 1000 6 1440 52 L1440 120 L0 120 Z" fill="#fbf8f4" />
          <path d="M0 70 C360 128 1000 6 1440 52" fill="none" stroke="#f0b738" strokeWidth="5" />
          <path d="M0 84 C380 134 1010 22 1440 64" fill="none" stroke="#8a1218" strokeOpacity="0.25" strokeWidth="2" />
        </svg>
      </div>
      <main className="evsu-join__card">
        <div className="evsu-join__badge">
          <img src={logo} alt="Gradify, EVSU Grading System" className="evsu-join__logo" width="560" height="560" />
        </div>
        {children}
      </main>
      <p className="evsu-join__foot">Eastern Visayas State University</p>
    </div>
  );
}

/** Round icon above a status message (link not valid, closed, enrolled). */
function NoticeIcon({ icon: Icon }) {
  return <span className="evsu-join__notice-icon"><Icon size={30} aria-hidden="true" /></span>;
}

/** A titled group of fields, numbered so a long form on a phone reads as a few short steps. */
function Group({ step, title, children }) {
  return (
    <fieldset className="evsu-join__group">
      <legend><span className="evsu-join__step" aria-hidden="true">{step}</span>{title}</legend>
      {children}
    </fieldset>
  );
}

function ClassHeading({ info }) {
  const c = info.class;
  return (
    <header className="evsu-join__class">
      <h1 className="evsu-join__title">
        <span className="evsu-join__title-lead">Enroll in</span>{' '}
        <span className="evsu-join__title-code">{c.subjectCode} · {c.section}</span>
      </h1>
      <p className="evsu-join__subject">{c.subjectTitle}</p>
      <ul className="evsu-join__meta">
        {info.instructor && (
          <li><UserRound size={15} aria-hidden="true" /><span className="visually-hidden">Instructor: </span>{info.instructor}</li>
        )}
        <li><CalendarDays size={15} aria-hidden="true" />{SEMESTER_LABELS[c.semester] ?? c.semester}, SY {c.schoolYear}</li>
      </ul>
    </header>
  );
}

/**
 * Public page opened from a class's QR code: a student enrolls themselves, without signing in,
 * while the instructor has QR enrollment switched on.
 */
export default function JoinClassPage() {
  const { token } = useParams();
  const [done, setDone] = useState(null);
  const [formError, setFormError] = useState(null);
  // Set when the course / year / section entered differs from the class's (server check).
  const [mismatch, setMismatch] = useState(null);
  // True from the click until the server answers: both Enroll buttons are locked meanwhile.
  const [enrolling, setEnrolling] = useState(false);
  const inFlight = useRef(false);
  const info = useQuery({ queryKey: ['join', token], queryFn: () => publicApi.getJoinInfo(token), retry: false });
  const { register, handleSubmit, setError, getValues, setFocus, formState: { errors } } = useForm({
    defaultValues: { studentNumber: '', lastName: '', firstName: '', middleName: '', email: '', course: '', yearLevel: '', section: '' },
  });

  if (info.isPending) {
    return <Shell><div className="evsu-join__loading"><Spinner label="Loading the class…" /></div></Shell>;
  }
  if (info.error) {
    return (
      <Shell>
        <div className="evsu-join__notice" role="alert">
          <NoticeIcon icon={CircleAlert} />
          <h1 className="evsu-join__notice-title">This link doesn&apos;t work</h1>
          <p className="mb-0">{info.error.status === 404 ? info.error.message : 'The class could not be loaded. Check your connection and try again.'}</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="evsu-join__notice is-success" role="status">
          <NoticeIcon icon={CircleCheck} />
          <h1 className="evsu-join__notice-title">You&apos;re enrolled</h1>
          <dl className="evsu-join__receipt">
            <div><dt>Student</dt><dd>{done.student.fullName}</dd></div>
            <div><dt>Student number</dt><dd>{done.student.studentNumber}</dd></div>
            <div><dt>Class</dt><dd>{done.class.subjectCode} · {done.class.section}</dd></div>
            <div><dt>Subject</dt><dd>{done.class.subjectTitle}</dd></div>
          </dl>
          <p className="small mt-2 mb-0">You can close this page.</p>
        </div>
      </Shell>
    );
  }

  if (!info.data.open) {
    return (
      <Shell>
        <ClassHeading info={info.data} />
        <div className="evsu-join__notice" role="status">
          <NoticeIcon icon={Lock} />
          <h2 className="evsu-join__notice-title">Enrollment is closed</h2>
          <p className="mb-0">Your instructor isn&apos;t accepting enrollments for this class right now. Ask them when it opens.</p>
        </div>
      </Shell>
    );
  }

  const submit = async (values, { confirmMismatch = false } = {}) => {
    if (inFlight.current) return; // a second tap before the button is disabled
    inFlight.current = true;
    setEnrolling(true);
    setFormError(null);
    if (!confirmMismatch) setMismatch(null);
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f, typeof values[f] === 'string' ? values[f].trim() : values[f]]));
      body.yearLevel = Number(body.yearLevel);
      if (!body.middleName) body.middleName = null;
      if (confirmMismatch) body.confirmMismatch = true;
      setDone(await publicApi.selfEnroll(token, body));
    } catch (error) {
      if (error.code === 'CLASS_MISMATCH' && error.details?.expected) {
        // Probably the wrong class (or a typo): point at the fields that differ and ask.
        const { expected, fields } = error.details;
        const hint = {
          course: `This class is for ${expected.course}.`,
          yearLevel: `This class is for year ${expected.yearLevel}.`,
          section: `This class is for section ${expected.section}.`,
        };
        fields.forEach((f) => setError(f, { type: 'mismatch', message: hint[f] }));
        setMismatch({ message: error.message, expected });
        return;
      }
      setMismatch(null);
      if (!applyServerErrors(error, setError, FIELDS)) setFormError(error.message);
    } finally {
      inFlight.current = false;
      setEnrolling(false);
    }
  };
  const onSubmit = (values) => submit(values);
  const required = (label) => ({ validate: (v) => String(v).trim().length > 0 || `Enter your ${label}.` });

  return (
    <Shell>
      <ClassHeading info={info.data} />
      <p className="evsu-join__tip">
        <Info size={17} aria-hidden="true" />
        <span>Fill in your details exactly as in your school records. Each student number can enroll once.</span>
      </p>
      {formError && <div className="alert alert-danger small" role="alert">{formError}</div>}
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Group step="1" title="Your ID">
          <TextField label="Student number" required autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="e.g. 2024-10301"
            error={errors.studentNumber?.message} {...register('studentNumber', required('student number'))} />
        </Group>
        <Group step="2" title="Your name">
          <div className="evsu-join__pair">
            <TextField label="Last name" required autoComplete="family-name" error={errors.lastName?.message} {...register('lastName', required('last name'))} />
            <TextField label="First name" required autoComplete="given-name" error={errors.firstName?.message} {...register('firstName', required('first name'))} />
          </div>
          <TextField label="Middle name" autoComplete="additional-name" error={errors.middleName?.message} {...register('middleName')} />
        </Group>
        <Group step="3" title="Your class">
          <div className="evsu-join__triple">
            <TextField label="Course" required placeholder="e.g. BSIT" autoCapitalize="characters" error={errors.course?.message} {...register('course', required('course'))} />
            <SelectField label="Year level" required options={YEAR_OPTIONS} placeholder="Select" error={errors.yearLevel?.message} {...register('yearLevel', required('year level'))} />
            <TextField label="Section" required placeholder="e.g. A" autoCapitalize="characters" error={errors.section?.message} {...register('section', required('section'))} />
          </div>
        </Group>
        <Group step="4" title="Contact">
          <TextField label="Email" type="email" inputMode="email" autoComplete="email" required placeholder="name@example.com" error={errors.email?.message}
            {...register('email', { validate: (v) => (v.trim() ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Enter a valid email address.' : 'Enter your email.') })} />
        </Group>
        {mismatch ? (
          <div className="evsu-join__mismatch" role="alert">
            <p className="fw-semibold mb-1 d-flex gap-2"><TriangleAlert size={18} className="flex-shrink-0 mt-1" aria-hidden="true" /> Are you irregular students?</p>
            <p className="small mb-2">{mismatch.message} Check your details, or enroll anyway if your instructor told you to join this class.</p>
            <div className="d-flex flex-wrap gap-2">
              <button type="button" className="btn btn-light" disabled={enrolling} onClick={() => { setMismatch(null); setFocus('course'); }}>Fix my details</button>
              <button type="button" className="btn btn-primary" disabled={enrolling} aria-busy={enrolling || undefined}
                onClick={() => submit(getValues(), { confirmMismatch: true })}>
                {enrolling ? <><Spinner size="sm" label="" className="me-2" />Enrolling…</> : 'Enroll anyway'}
              </button>
            </div>
          </div>
        ) : (
          <button type="submit" className="btn btn-primary evsu-join__submit" disabled={enrolling} aria-busy={enrolling || undefined}>
            {enrolling ? <><Spinner size="sm" label="" /> Enrolling…</> : <>Enroll <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        )}
      </form>
    </Shell>
  );
}
