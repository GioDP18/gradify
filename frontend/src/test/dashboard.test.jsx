import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as dashboardApi from '../services/dashboardApi';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/dashboardApi', () => ({
  getOverview: vi.fn(),
  getAttendanceDashboard: vi.fn(),
  getPerformanceDashboard: vi.fn(),
  getRecentActivity: vi.fn(),
}));
vi.mock('../services/studentsApi', () => ({ listStudents: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }), getStudentFacets: vi.fn().mockResolvedValue({ courses: [], sections: [], yearLevels: [] }) }));

const overview = {
  scope: 'CLASS', class: { id: 'c1' }, gradesPeriod: 'OVERALL', totalStudents: 32, droppedStudents: 1,
  attendance: { sessions: 12, present: 350, absent: 20, excused: 14, total: 384, attendanceRate: 94.79 },
  studentsComplete: 25, studentsIncomplete: 6, studentsNotComputable: 0, studentsPending: 0, classAverage: 84.37, passed: 23,
  instructor: { activeClasses: 1, activeStudents: 33 },
  classes: [{ id: 'c1', subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST', students: 32, complete: 25, passed: 23, incomplete: 6, dropped: 1, average: 84.37, attendanceRate: 94.79 }],
};
const performance = {
  focusPeriod: 'OVERALL',
  periods: {
    MIDTERM: { classAverage: 82.1 }, FINALS: { classAverage: 85.9 }, OVERALL: { classAverage: 84.37 },
  },
  distribution: [{ label: '1.0–1.4', count: 3 }, { label: 'INC', count: 6 }],
  top: [{ studentId: 's1', fullName: 'Bautista, Ana', percentage: 96.2, grade: 1.0, remarks: 'Excellent' }],
  bottom: [{ studentId: 's9', fullName: 'Ignacio, Ivan', percentage: 71.1, grade: 4.0, remarks: 'Conditional Failure' }],
  incomplete: [{ studentId: 's5', fullName: 'Cruz, Ben', completionStatus: 'INCOMPLETE', missingCount: 2, missingItems: [{ title: 'Quiz 3' }, { title: 'Final Exam' }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(dashboardApi.getOverview).mockResolvedValue(overview);
  vi.mocked(dashboardApi.getAttendanceDashboard).mockResolvedValue({
    periods: { MIDTERM: { sessions: 8, present: 240, absent: 10, excused: 6, total: 256, attendanceRate: 96.09 }, FINALS: { sessions: 4, present: 110, absent: 10, excused: 8, total: 128, attendanceRate: 92.19 } },
    trend: [{ sessionId: 'a1', date: '2026-09-01', period: 'MIDTERM', present: 30, absent: 2, excused: 0, total: 32, attendanceRate: 93.75 }],
  });
  vi.mocked(dashboardApi.getPerformanceDashboard).mockResolvedValue(performance);
  vi.mocked(dashboardApi.getRecentActivity).mockResolvedValue([{ id: 'x1', action: 'QUIZ_SCORES_UPDATE', message: 'Updated 3 quiz scores — Quiz 3', at: '2026-11-22T01:00:00Z' }]);
});

describe('dashboard, all classes (default)', () => {
  it('summarizes every active class until one is chosen in the class switcher', async () => {
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'All classes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Active class')).toHaveValue('ALL');
    await waitFor(() => expect(dashboardApi.getOverview).toHaveBeenCalledWith({ classId: undefined, period: '', from: '', to: '' }));
    expect(dashboardApi.getPerformanceDashboard).toHaveBeenCalledWith({ classId: undefined, period: undefined });

    // Grade and attendance pages work inside one class, so these figures are not links here.
    expect(await screen.findByRole('link', { name: /Total students: 32/ })).toHaveAttribute('href', '/students');
    expect(screen.queryByRole('link', { name: /Complete scores/ })).not.toBeInTheDocument();

    const classes = screen.getByRole('region', { name: 'Your classes' });
    expect(within(classes).getByText('IT 101 · BSIT-1A')).toBeInTheDocument();
    expect(within(classes).getByRole('columnheader', { name: 'DRP' })).toBeInTheDocument();
    expect(within(classes).getByTitle('Dropped')).toHaveTextContent('1');
    expect(within(classes).getByRole('columnheader', { name: 'Failed' })).toBeInTheDocument();
    expect(within(classes).getByTitle('Grade below 3.0')).toHaveTextContent('2');
    await userEvent.click(within(classes).getByRole('button', { name: 'Show only IT 101 · BSIT-1A' }));
    await waitFor(() => expect(dashboardApi.getOverview).toHaveBeenLastCalledWith({ classId: 'c1', period: '', from: '', to: '' }));
    expect(screen.getByLabelText('Active class')).toHaveValue('c1');
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('dashboard, one class', () => {
  // The class switcher is set to IT 101 (remembered from an earlier visit).
  beforeEach(() => window.localStorage.setItem('evsu.classScope.u1', 'c1'));

  it('shows real statistics for the working class as clickable cards', async () => {
    renderApp('/');
    const total = await screen.findByRole('link', { name: /Total students: 32/ });
    expect(total).toHaveAttribute('href', '/students?scope=class');
    expect(screen.getByRole('link', { name: /Total present: 350/ })).toHaveAttribute('href', '/attendance');
    expect(screen.getByRole('link', { name: /Total absent: 20/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Total excused: 14/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Complete scores: 25/ })).toHaveAttribute('href', '/grading?period=overall&status=COMPLETE');
    expect(screen.getByRole('link', { name: /Failed: 2/ })).toHaveAttribute('href', '/grading?period=overall&status=FAILED');
    expect(screen.getByRole('link', { name: /Incomplete scores: 6/ })).toHaveAttribute('href', '/grading?period=overall&status=INCOMPLETE');
    expect(screen.getByRole('link', { name: /Class average: 84.37%/ })).toBeInTheDocument();
    expect(dashboardApi.getOverview).toHaveBeenCalledWith({ classId: 'c1', period: '', from: '', to: '' });
  });

  it('shows Midterm and Finals attendance summaries, performance lists, and recent activity', async () => {
    renderApp('/');
    expect(await screen.findByText('96.09%')).toBeInTheDocument();
    expect(screen.getByText('92.19%')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Bautista, Ana' })).toHaveAttribute('href', '/grading/overall/student/s1?classId=c1');
    expect(screen.getByRole('link', { name: 'Ignacio, Ivan' })).toBeInTheDocument();
    const incomplete = screen.getByRole('region', { name: /Incomplete grading records \(1\)/ });
    expect(within(incomplete).getByText('Quiz 3, Final Exam')).toBeInTheDocument();
    expect(screen.getByText('Updated 3 quiz scores — Quiz 3')).toBeInTheDocument();
  });

  it('applies the grading period and date filters', async () => {
    renderApp('/');
    await screen.findByRole('link', { name: /Total students/ });
    await userEvent.selectOptions(screen.getByLabelText('Grades for'), 'MIDTERM');
    await waitFor(() => expect(dashboardApi.getOverview).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'MIDTERM' })));
    await waitFor(() => expect(dashboardApi.getPerformanceDashboard).toHaveBeenLastCalledWith({ classId: 'c1', period: 'MIDTERM' }));
    expect(screen.getByRole('link', { name: /Complete scores/ })).toHaveAttribute('href', '/grading?period=midterm&status=COMPLETE');

    const from = screen.getByLabelText('Attendance from');
    await userEvent.type(from, '2026-09-05');
    await waitFor(() => expect(dashboardApi.getAttendanceDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-09-05' })));
  });

  it('searches for a student from the dashboard', async () => {
    const { router } = renderApp('/');
    await userEvent.type(await screen.findByLabelText('Find a student'), 'dela cruz{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(router.state.location.search).toBe('?q=dela%20cruz');
  });

  it('asks to create a class when there are none', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([]);
    renderApp('/');
    expect(await screen.findByText('Set up your first class')).toBeInTheDocument();
    expect(dashboardApi.getOverview).not.toHaveBeenCalled();
  });
});
