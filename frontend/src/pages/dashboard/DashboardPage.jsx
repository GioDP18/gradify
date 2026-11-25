import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Clock, CircleCheck, CircleAlert, CircleX, CalendarPlus, PenLine, UserPlus, GraduationCap, School, Search, Activity, ChevronRight,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { useClassContext, SEMESTER_LABELS, formatClassLabel, formatTerm } from '../../context/ClassContext';
import { useDashboardOverview, useDashboardAttendance, useDashboardPerformance, useRecentActivity } from '../../hooks/useDashboard';
import StatCard from '../../components/common/StatCard';
import GradeChip from '../../components/grading/GradeChip';
import { EmptyState, ErrorState, Skeleton, SkeletonCards } from '../../components/common/States';
import { CHART, bucketFill } from '../../config/chartTheme';
import { formatPercent, formatPercentFixed, formatDateOnly } from '../../utils/format';
import './dashboard.css';

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const PERIOD_OPTIONS = [
  { value: '', label: 'Final grade (all periods)' },
  { value: 'MIDTERM', label: 'Midterm' },
  { value: 'FINALS', label: 'Finals' },
];
const gradingParam = (period) => (period === 'MIDTERM' ? 'midterm' : period === 'FINALS' ? 'finals' : 'overall');

function Panel({ title, children, action, labelledBy, className = '' }) {
  return (
    <section className={`evsu-card p-3 p-md-4 ${className}`} aria-labelledby={labelledBy}>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h3 id={labelledBy} className="h6 mb-0">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One horizontal strip with a segment per grade bucket, sized by how many students fall in it. */
function GradeSpectrum({ classId, period }) {
  const { data, isPending } = useDashboardPerformance({ classId, period });
  if (isPending) return <span className="evsu-spectrum__bar evsu-spectrum__bar--loading" aria-hidden="true" />;
  const buckets = (data?.distribution ?? []).filter((d) => d.count > 0);
  const total = buckets.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return <p className="evsu-hero__note mb-0">The grade spectrum appears once students have grades.</p>;
  return (
    <figure className="evsu-spectrum mb-0">
      <div className="evsu-spectrum__bar" role="img" aria-label={`Grade spectrum: ${buckets.map((d) => `${d.label}: ${d.count}`).join(', ')}`}>
        {buckets.map((d) => (
          <span key={d.label} style={{ flexGrow: d.count, background: bucketFill(d.label) }} title={`${d.label}: ${d.count}`} />
        ))}
      </div>
      <figcaption className="evsu-spectrum__legend" aria-hidden="true">
        {buckets.map((d) => (
          <span key={d.label}><i style={{ background: bucketFill(d.label) }} />{d.label} <b>{d.count}</b></span>
        ))}
      </figcaption>
    </figure>
  );
}

function ClassBanner({ activeClass, allClasses, classCount, firstName, overview, classId, period, gp }) {
  const navigate = useNavigate();
  const [studentQuery, setStudentQuery] = useState('');
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label;
  const average = formatPercent(overview?.classAverage);
  const averageBody = (
    <>
      {overview ? <span className="evsu-hero__figure">{average}</span> : <Skeleton width="8rem" height="3rem" />}
      <span className="evsu-hero__caption">
        {allClasses ? 'Average across all classes' : 'Class average'}, {periodLabel?.toLowerCase()}
        {!allClasses && <ChevronRight size={14} aria-hidden="true" />}
      </span>
    </>
  );
  return (
    <section className="evsu-hero mb-4" aria-labelledby="dash-greeting">
      <div className="evsu-hero__top">
        <div>
          <h2 id="dash-greeting" className="evsu-hero__greeting">{greeting()}, {firstName}</h2>
          {allClasses ? (
            <>
              <h3 className="evsu-hero__class">All classes</h3>
              <p className="evsu-hero__meta mb-0">
                <span>{classCount} active class{classCount === 1 ? '' : 'es'}</span>
                {overview && <span>{overview.totalStudents} student{overview.totalStudents === 1 ? '' : 's'}</span>}
              </p>
            </>
          ) : (
            <>
              <h3 className="evsu-hero__class">
                <span className="visually-hidden">{formatClassLabel(activeClass)}</span>
                <span aria-hidden="true">{activeClass.subjectCode}</span>
                <span className="evsu-hero__section" aria-hidden="true">{activeClass.section}</span>
              </h3>
              <p className="evsu-hero__meta mb-0">
                <span>{activeClass.subjectTitle}</span>
                <span>{SEMESTER_LABELS[activeClass.semester] ?? activeClass.semester}, SY {activeClass.schoolYear}</span>
              </p>
            </>
          )}
        </div>
        <form
          className="evsu-search evsu-hero__search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (studentQuery.trim()) navigate(`/students?q=${encodeURIComponent(studentQuery.trim())}`);
          }}
        >
          <Search size={16} aria-hidden="true" className="evsu-search__icon" />
          <input type="search" className="form-control" placeholder="Find a student…" aria-label="Find a student" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} />
        </form>
      </div>

      <div className="evsu-hero__body">
        {allClasses ? (
          <div className="evsu-hero__average">{averageBody}</div>
        ) : (
          <Link to={`/grading?period=${gp}`} className="evsu-hero__average" aria-label={`Class average: ${average}${periodLabel ? `, ${periodLabel}` : ''}`}>
            {averageBody}
          </Link>
        )}
        <div className="evsu-hero__spectrum">
          <GradeSpectrum classId={classId} period={period || undefined} />
        </div>
      </div>
    </section>
  );
}

/** "All classes" only: one row per class, with a button to focus the dashboard on it. */
function ClassesPanel({ overview, onFocus }) {
  if (!overview) return <Skeleton height="8rem" />;
  return (
    <Panel title="Your classes" labelledBy="dash-classes" className="mb-4">
      <div className="evsu-table-wrap">
        <table className="table evsu-table align-middle">
          <thead>
            <tr>
              <th scope="col">Class</th>
              <th scope="col" className="text-end">Students</th>
              <th scope="col" className="text-end">Average</th>
              <th scope="col" className="text-end">Passing</th>
              <th scope="col" className="text-end">Failed</th>
              <th scope="col" className="text-end">INC</th>
              <th scope="col" className="text-end">DRP</th>
              <th scope="col" className="text-end">Attendance</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {overview.classes.map((c) => (
              <tr key={c.id}>
                <th scope="row" data-label="Class">
                  <span className="d-block">{formatClassLabel(c)}</span>
                  <span className="d-block small text-muted-evsu fw-normal">{c.subjectTitle} · {formatTerm(c)}</span>
                </th>
                <td className="text-end" data-label="Students">{c.students}</td>
                <td className="text-end" data-label="Average">{formatPercent(c.average)}</td>
                <td className="text-end" data-label="Passing">{c.complete ? `${c.passed} of ${c.complete}` : '—'}</td>
                <td className="text-end" data-label="Failed">{c.complete - c.passed ? <span className="evsu-status evsu-status--error" title="Grade below 3.0">{c.complete - c.passed}</span> : '0'}</td>
                <td className="text-end" data-label="INC">{c.incomplete ? <span className="evsu-status evsu-status--error">{c.incomplete}</span> : '0'}</td>
                <td className="text-end" data-label="DRP">{c.dropped ? <span className="evsu-status evsu-status--warn" title="Dropped">{c.dropped}</span> : '0'}</td>
                <td className="text-end" data-label="Attendance">{formatPercent(c.attendanceRate)}</td>
                <td className="text-end" data-label="">
                  <button type="button" className="btn btn-sm btn-light" onClick={() => onFocus(c.id)} aria-label={`Show only ${formatClassLabel(c)}`}>
                    View class <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AttendancePanel({ classId, from, to, allClasses }) {
  const { data, isPending, error, refetch } = useDashboardAttendance({ classId, from, to });
  if (error) return <ErrorState title="Attendance unavailable" error={error} onRetry={refetch} />;
  if (isPending) return <Skeleton height="12rem" />;
  const trend = data.trend.map((t) => ({ ...t, label: formatDateOnly(t.date, { month: 'short', day: 'numeric' }), midterm: t.period === 'MIDTERM' ? t.attendanceRate : null, finals: t.period === 'FINALS' ? t.attendanceRate : null }));
  return (
    <>
      <div className="row g-2 mb-3">
        {['MIDTERM', 'FINALS'].map((p) => {
          const s = data.periods[p];
          const body = (
            <>
              <span className="small fw-semibold text-muted-evsu">{p === 'MIDTERM' ? 'Midterm' : 'Finals'} attendance</span>
              <span className="evsu-stat-value">{formatPercent(s.attendanceRate)}</span>
              <span className="evsu-att-mini small text-muted-evsu">
                <span>{s.sessions} session{s.sessions === 1 ? '' : 's'}</span>
                <span><i className="is-p" />{s.present} present</span>
                <span><i className="is-a" />{s.absent} absent</span>
                <span><i className="is-e" />{s.excused} excused</span>
              </span>
            </>
          );
          return (
            <div key={p} className="col-sm-6">
              {allClasses ? (
                <div className="evsu-card evsu-stat-card p-3 h-100">{body}</div>
              ) : (
                <Link to={`/attendance${p === 'FINALS' ? '?period=FINALS' : ''}`} className="evsu-card evsu-stat-card evsu-stat-card--link p-3 h-100">{body}</Link>
              )}
            </div>
          );
        })}
      </div>
      {trend.length === 0 ? (
        <p className="small text-muted-evsu mb-0">No attendance sessions in this date range yet.</p>
      ) : (
        <div style={{ width: '100%', height: 220 }} role="img" aria-label={`Attendance trend: ${trend.map((t) => `${t.label} ${formatPercent(t.attendanceRate)}`).join(', ')}`}>
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 4, right: 12, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" tick={CHART.tick} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={CHART.tick} unit="%" axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => (v === null ? '—' : formatPercent(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line isAnimationActive={false} type="monotone" dataKey="midterm" name="Midterm" stroke={CHART.maroon} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} connectNulls />
              <Line isAnimationActive={false} type="monotone" dataKey="finals" name="Finals" stroke={CHART.gold} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {allClasses && trend.length > 0 && <p className="small text-muted-evsu mt-2 mb-0">Sessions from different classes on the same day are combined.</p>}
    </>
  );
}

const studentReportHref = (period, s, classId) => `/grading/${gradingParam(period)}/student/${s.studentId}?classId=${s.classId ?? classId}`;

function ClassTag({ show, label }) {
  return show && label ? <span className="evsu-class-tag">{label}</span> : null;
}

function RankList({ students, emptyText, classId, period, allClasses }) {
  if (!students.length) return <p className="small text-muted-evsu mb-0">{emptyText}</p>;
  return (
    <ol className="list-unstyled evsu-rank-list mb-0">
      {students.map((s) => (
        <li key={`${s.classId}-${s.studentId}`}>
          <span className="text-truncate">
            <Link to={studentReportHref(period, s, classId)} className="text-reset">{s.fullName}</Link>
            <ClassTag show={allClasses} label={s.classLabel} />
          </span>
          <span className="d-inline-flex align-items-center gap-2 text-nowrap">
            <span className="small text-muted-evsu">{formatPercentFixed(s.percentage)}</span>
            <GradeChip size="sm" grade={s.grade} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function PerformancePanels({ classId, period, allClasses }) {
  const { data, isPending, error, refetch } = useDashboardPerformance({ classId, period });
  if (error) return <div className="evsu-card"><ErrorState title="Performance unavailable" error={error} onRetry={refetch} /></div>;
  if (isPending) return <SkeletonCards count={2} />;
  const averages = [
    { label: 'Midterm', value: data.periods.MIDTERM.classAverage },
    { label: 'Finals', value: data.periods.FINALS.classAverage },
    { label: 'Final grade', value: data.periods.OVERALL.classAverage },
  ];
  return (
    <div className="evsu-dash-panels">
      <Panel title={allClasses ? 'Average per grading period, all classes' : 'Class average per grading period'} labelledBy="dash-averages"
        action={!allClasses && <Link to={`/grading${period ? `?period=${gradingParam(period)}` : '?period=overall'}`} className="small">Open grading</Link>}>
        <div style={{ width: '100%', height: 200 }} role="img" aria-label={`Class averages: ${averages.map((a) => `${a.label} ${formatPercent(a.value)}`).join(', ')}`}>
          <ResponsiveContainer>
            <BarChart data={averages.map((a) => ({ label: a.label, raw: a.value, value: a.value ?? 0 }))} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" tick={{ ...CHART.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={CHART.tick} unit="%" axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(138, 28, 34, 0.05)' }} formatter={(v, name, item) => (item.payload.raw === null ? 'No complete grades yet' : formatPercent(v))} />
              <Bar isAnimationActive={false} dataKey="value" fill={CHART.maroon} radius={[8, 8, 0, 0]} name="Average" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="small text-muted-evsu mb-0">Averages of complete grades only. INC, DRP, and not-computable students are excluded.</p>
      </Panel>

      <Panel title={`Incomplete grading records (${data.incomplete.length})`} labelledBy="dash-incomplete"
        action={!allClasses && data.incomplete.length > 0 && <Link to={`/grading?period=${gradingParam(period)}&status=INCOMPLETE`} className="small">View all</Link>}>
        {data.incomplete.length === 0 ? (
          <p className="small text-muted-evsu mb-0">No incomplete records.</p>
        ) : (
          <ul className="list-unstyled evsu-rank-list mb-0">
            {data.incomplete.slice(0, 8).map((s) => (
              <li key={`${s.classId}-${s.studentId}`}>
                <span className="text-truncate">
                  <Link to={studentReportHref(period, s, classId)} className="text-reset">{s.fullName}</Link>
                  <ClassTag show={allClasses} label={s.classLabel} />
                  <span className="d-block small text-danger">{s.missingItems.map((m) => m.title).join(', ')}{s.missingCount > s.missingItems.length ? '…' : ''}</span>
                </span>
                <span className="evsu-status evsu-status--error align-self-start">{s.completionStatus === 'INC_LAPSED' ? '5.0 lapsed' : 'INC'}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Highest-performing students" labelledBy="dash-top">
        <RankList students={data.top} emptyText="No complete grades yet." classId={classId} period={period} allClasses={allClasses} />
      </Panel>
      <Panel title="Lowest-performing students" labelledBy="dash-bottom">
        <RankList students={data.bottom} emptyText="No complete grades yet." classId={classId} period={period} allClasses={allClasses} />
      </Panel>
    </div>
  );
}

function ActivityPanel({ classId, allClasses }) {
  const { data, isPending, error } = useRecentActivity({ classId, limit: 8 });
  return (
    <Panel title="Recent activity" labelledBy="dash-activity">
      {isPending && <Skeleton height="6rem" />}
      {error && <p className="small text-danger mb-0">{error.message}</p>}
      {data && data.length === 0 && <p className="small text-muted-evsu mb-0">No activity yet.</p>}
      {data && data.length > 0 && (
        <ul className="list-unstyled evsu-timeline mb-0">
          {data.map((a) => (
            <li key={a.id}>
              <span className="evsu-timeline__dot" aria-hidden="true"><Activity size={12} /></span>
              <span className="evsu-timeline__text">{a.message}<ClassTag show={allClasses} label={a.classLabel} /></span>
              <time className="small text-muted-evsu text-nowrap" dateTime={a.at}>{new Date(a.at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const QUICK_ACTIONS = (gp) => [
  { to: '/attendance', icon: CalendarPlus, label: 'Take attendance', hint: 'Start a session' },
  { to: '/quizzes', icon: PenLine, label: 'Record quiz scores', hint: 'Written work' },
  { to: '/students', icon: UserPlus, label: 'Add students', hint: 'One at a time or CSV' },
  { to: `/grading?period=${gp}`, icon: GraduationCap, label: 'View grades', hint: 'Midterm, Finals, Final' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const { activeClass, activeClasses, allClasses, selectClass, isLoading } = useClassContext();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  // "All classes" sends no classId: the backend then summarizes every active class.
  const classId = allClasses ? undefined : activeClass?.id;

  const overview = useDashboardOverview({ classId, period, from, to, enabled: activeClasses.length > 0 });

  const setParam = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const firstName = user?.name?.split(' ')[0] ?? '';

  if (isLoading) return <SkeletonCards count={4} />;
  if (activeClasses.length === 0) {
    return (
      <>
        <h2 className="h3 mb-3">{greeting()}, {firstName}</h2>
        <div className="evsu-card">
          <EmptyState icon={School} title="Set up your first class" description="Classes hold your students, attendance, assessments, and grades for one subject and section."
            action={<Link to="/classes" className="btn btn-primary">Go to Classes</Link>} />
        </div>
      </>
    );
  }

  const o = overview.data;
  const gp = gradingParam(period);
  const periodQuery = period ? `?period=${period}` : '';
  // Grading and attendance pages work inside one class, so tiles only link there for one class.
  const linkTo = (href) => (allClasses ? undefined : href);

  return (
    <>
      <ClassBanner activeClass={activeClass} allClasses={allClasses} classCount={activeClasses.length} firstName={firstName} overview={o} classId={classId} period={period} gp={gp} />

      <div className="evsu-toolbar evsu-dash-filters">
        <label htmlFor="dash-period" className="small text-muted-evsu">Grades for</label>
        <select id="dash-period" className="form-select form-select-sm w-auto" value={period} onChange={(e) => setParam({ period: e.target.value })}>
          {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <label htmlFor="dash-from" className="small text-muted-evsu ms-md-2">Attendance from</label>
        <input id="dash-from" type="date" className="form-control form-control-sm w-auto" value={from} max={to || undefined} onChange={(e) => setParam({ from: e.target.value })} />
        <label htmlFor="dash-to" className="small text-muted-evsu">to</label>
        <input id="dash-to" type="date" className="form-control form-control-sm w-auto" value={to} min={from || undefined} onChange={(e) => setParam({ to: e.target.value })} />
        {(period || from || to) && <button type="button" className="btn btn-sm btn-link" onClick={() => setParams({}, { replace: true })}>Reset filters</button>}
      </div>

      {overview.error ? (
        <div className="evsu-card mb-3"><ErrorState title="Could not load the dashboard" error={overview.error} onRetry={overview.refetch} /></div>
      ) : (
        <>
        {/* Two rows, each its own full-width grid: students and grades, then attendance. */}
        <div className="evsu-dash-grid mb-3">
          <StatCard label="Total students" icon={Users} value={o?.totalStudents ?? '—'} hint={o?.droppedStudents ? `${o.droppedStudents} dropped` : 'currently enrolled'} to={allClasses ? '/students' : '/students?scope=class'} loading={!o} />
          <StatCard label="Complete scores" icon={CircleCheck} tone="ok" value={o?.studentsComplete ?? '—'} hint={`${o?.passed ?? 0} passing`} to={linkTo(`/grading?period=${gp}&status=COMPLETE`)} loading={!o} />
          <StatCard label="Failed" icon={CircleX} tone="error" value={o ? o.studentsComplete - o.passed : '—'} hint="grade below 3.0" to={linkTo(`/grading?period=${gp}&status=FAILED`)} loading={!o} />
          <StatCard label="Incomplete scores" icon={CircleAlert} tone="error" value={o?.studentsIncomplete ?? '—'} hint={o?.studentsNotComputable ? `${o.studentsNotComputable} not computable` : 'INC'} to={linkTo(`/grading?period=${gp}&status=INCOMPLETE`)} loading={!o} />
        </div>
        <div className="evsu-dash-grid mb-4">
          <StatCard label="Total present" icon={UserCheck} tone="ok" value={o?.attendance.present ?? '—'} hint={`${o?.attendance.sessions ?? 0} sessions`} to={linkTo(`/attendance${periodQuery}`)} loading={!o} />
          <StatCard label="Total absent" icon={UserX} tone="error" value={o?.attendance.absent ?? '—'} hint="attendance records" to={linkTo(`/attendance${periodQuery}`)} loading={!o} />
          <StatCard label="Total excused" icon={Clock} tone="warn" value={o?.attendance.excused ?? '—'} hint={`rate ${formatPercent(o?.attendance.attendanceRate)}`} to={linkTo(`/attendance${periodQuery}`)} loading={!o} />
        </div>
        </>
      )}

      {o?.studentsPending > 0 && (
        <div className="alert alert-warning small" role="status">{o.studentsPending} grade(s) are being recalculated; figures update automatically.</div>
      )}

      {allClasses && !overview.error && <ClassesPanel overview={o} onFocus={selectClass} />}

      <div className="evsu-dash-main mb-4">
        <Panel title={allClasses ? 'Attendance, all classes' : 'Attendance'} labelledBy="dash-attendance" action={!allClasses && <Link to="/attendance" className="small">Open attendance</Link>}>
          <AttendancePanel classId={classId} from={from} to={to} allClasses={allClasses} />
        </Panel>
        <div className="d-flex flex-column gap-3">
          <section className="evsu-quick" aria-labelledby="dash-actions">
            <h3 id="dash-actions" className="visually-hidden">Quick actions</h3>
            {QUICK_ACTIONS(gp).map(({ to: href, icon: Icon, label, hint }) => (
              <Link key={label} to={href} className="evsu-quick__item">
                <span className="evsu-quick__icon" aria-hidden="true"><Icon size={18} /></span>
                <span className="evsu-quick__label">{label}<span>{hint}</span></span>
              </Link>
            ))}
          </section>
          <ActivityPanel classId={classId} allClasses={allClasses} />
        </div>
      </div>

      <h2 className="h4 mb-3">Academic performance</h2>
      <PerformancePanels classId={classId} period={period || undefined} allClasses={allClasses} />
    </>
  );
}
