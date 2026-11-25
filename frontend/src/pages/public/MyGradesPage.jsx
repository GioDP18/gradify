import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CircleAlert, Clock, UserRound } from 'lucide-react';
import Segmented from '../../components/common/Segmented';
import Spinner from '../../components/common/Spinner';
import GradeReportBody, { REPORT_PERIODS } from '../../components/grading/GradeReportBody';
import { SEMESTER_LABELS } from '../../context/ClassContext';
import * as publicApi from '../../services/publicApi';
import logo from '../../assets/brand/gradify-logo-clear.webp';
import './my-grades.css';

function Shell({ children }) {
  return (
    <div className="evsu-mygrades">
      <header className="evsu-mygrades__band">
        <div className="evsu-mygrades__brand">
          <span className="evsu-mygrades__logo"><img src={logo} alt="" width="560" height="560" /></span>
          <div>
            <p className="evsu-mygrades__eyebrow">Gradify · Eastern Visayas State University</p>
            <h1 className="evsu-mygrades__title">Your grading sheet</h1>
          </div>
        </div>
      </header>
      <main className="evsu-mygrades__main">{children}</main>
    </div>
  );
}

function Notice({ icon: Icon, title, children }) {
  return (
    <div className="evsu-card evsu-mygrades__notice" role="alert">
      <span className="evsu-mygrades__notice-icon"><Icon size={28} aria-hidden="true" /></span>
      <h2 className="h5 mb-2">{title}</h2>
      <p className="mb-0">{children}</p>
    </div>
  );
}

/**
 * Public page a student opens from the private link their instructor shared: their own grading
 * sheet for one class, read-only, showing how each grade was computed. No sign-in.
 */
export default function MyGradesPage() {
  const { token } = useParams();
  const [chosen, setChosen] = useState('midterm');
  const { data, isPending, error } = useQuery({ queryKey: ['my-grades', token], queryFn: () => publicApi.getSharedGrades(token), retry: false });

  if (isPending) {
    return <Shell><div className="evsu-card p-5 text-center"><Spinner label="Loading your grading sheet…" /></div></Shell>;
  }
  if (error) {
    if (error.status === 410) return <Shell><Notice icon={Clock} title="This link has expired">{error.message}</Notice></Shell>;
    return (
      <Shell>
        <Notice icon={CircleAlert} title="This link doesn’t work">
          {error.status === 404 ? error.message : 'Your grading sheet could not be loaded. Check your connection and try again.'}
        </Notice>
      </Shell>
    );
  }

  const { student: s, class: cls, configuration: config, grades } = data;
  // The instructor may have shared one grade only: then there is nothing to switch between.
  const tabs = REPORT_PERIODS.filter((tab) => tab.value in grades);
  const period = chosen in grades ? chosen : tabs[0]?.value;
  const grade = period ? grades[period] : null;

  return (
    <Shell>
      <section className="evsu-card p-3 p-md-4 mb-3" aria-labelledby="my-grades-student">
        <div className="d-flex flex-wrap justify-content-between gap-3">
          <div>
            <p className="small text-muted-evsu mb-1">{s.studentNumber}</p>
            <h2 id="my-grades-student" className="h4 mb-1">{s.fullName}</h2>
            <p className="mb-0 text-muted-evsu">{s.course} · Year {s.yearLevel} · Section {s.section}</p>
          </div>
          <div className="text-md-end">
            <p className="fw-semibold mb-0">{cls.subjectCode} · {cls.section}</p>
            <p className="small mb-1">{cls.subjectTitle}</p>
            <ul className="evsu-mygrades__meta">
              {data.instructor && <li><UserRound size={14} aria-hidden="true" /><span className="visually-hidden">Instructor: </span>{data.instructor}</li>}
              <li><CalendarDays size={14} aria-hidden="true" />{SEMESTER_LABELS[cls.semester] ?? cls.semester}, SY {cls.schoolYear}</li>
            </ul>
          </div>
        </div>
      </section>

      {tabs.length > 1 && (
        <Segmented label="Grading period" className="mb-3">
          {tabs.map((tab) => (
            <button key={tab.value} type="button" aria-pressed={tab.value === period} onClick={() => setChosen(tab.value)}>{tab.label}</button>
          ))}
        </Segmented>
      )}

      {grade
        ? <GradeReportBody grade={grade} config={config} period={period} />
        : <div className="evsu-card p-4 text-center text-muted-evsu">This grade has not been computed yet.</div>}

      <p className="evsu-mygrades__foot">
        Questions about your grade? Talk to your instructor{data.instructor ? `, ${data.instructor}` : ''}.
        {data.expiresAt && <> You can view this page until {new Date(data.expiresAt).toLocaleString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.</>}
        {' '}This page is only for you; please do not share the link.
      </p>
    </Shell>
  );
}
