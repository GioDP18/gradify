/**
 * Automated accessibility checks (axe-core, WCAG 2.x A/AA rules) on the main pages with
 * realistic data, plus the crash screens. jsdom has no layout engine, so colour-contrast is
 * verified separately; everything else (names, roles, labels, ARIA, structure) is checked here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import axe from 'axe-core';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import { RouteErrorPage, AppErrorBoundary } from '../components/common/ErrorBoundary';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));

const { rows, stats, comps, gradeRow, configuration, fullConfig } = vi.hoisted(() => {
  const rows = [
    { studentId: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', score: 18, itemPercent: 90, required: true, enrollmentStatus: 'ENROLLED', archived: false, status: 'PRESENT' },
    { studentId: 's2', studentNumber: '2026-002', fullName: 'Cruz, Ben', score: null, itemPercent: null, required: true, enrollmentStatus: 'DROPPED', archived: false, status: 'ABSENT' },
  ];
  const stats = { totalStudents: 2, scoredCount: 1, missingCount: 1, highest: 18, lowest: 18, average: 18, averagePercent: 90, distribution: [] };
  const comps = [
    { key: 'ATTENDANCE', label: 'Attendance', weight: 10, percentage: 90, weightedContribution: 9, rawScore: 9, maxScore: 10, present: 9, absent: 1, excused: 0 },
    { key: 'WRITTEN', label: 'Written Tasks/Quizzes', weight: 30, percentage: 85, weightedContribution: 25.5, rawScore: 85, maxScore: 100 },
    { key: 'PERFORMANCE', label: 'Performance Tasks/Assignments', weight: 20, percentage: 88, weightedContribution: 17.6, rawScore: 88, maxScore: 100 },
    { key: 'EXAM', label: 'Exam (Mid-term)', weight: 40, percentage: 80, weightedContribution: 32, rawScore: 80, maxScore: 100 },
  ];
  const gradeRow = { studentId: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', period: 'MIDTERM', current: true, calcStatus: 'CURRENT', completionStatus: 'COMPLETE', percentage: 84.1, roundedPercent: 84, grade: 2.1, remarks: 'Very Good', components: comps, missingItems: [], emptyComponents: [] };
  const configuration = {
    version: 1, periodWeights: { MIDTERM: 40, FINALS: 60 }, passingGrade: 3,
    periods: { MIDTERM: { label: 'Midterm Grade', components: comps.map(({ key, label, weight }) => ({ key, label, weight, source: 'x' })) }, FINALS: { label: 'Final Grade', components: comps.map(({ key, label, weight }) => ({ key, label, weight, source: 'x' })) } },
  };
  const fullConfig = {
    ...configuration, id: 'cfg', isActive: true, effectiveDate: '2026-11-01T00:00:00Z', createdAt: '2026-11-01T00:00:00Z', notes: null,
    gradeConversion: { passingGrade: 3, table: [{ minPercent: 95, maxPercent: 100, grade: 1 }], remarks: [{ minGrade: 1, maxGrade: 1.4, label: 'Excellent' }] },
    incompleteRule: { complianceMonths: 12, lapseGrade: 5 },
  };
  
    return { rows, stats, comps, gradeRow, configuration, fullConfig };
});

vi.mock('../services/dashboardApi', () => ({
  getOverview: vi.fn().mockResolvedValue({ totalStudents: 2, droppedStudents: 0, attendance: { sessions: 1, present: 1, absent: 1, excused: 0, total: 2, attendanceRate: 50 }, studentsComplete: 1, studentsIncomplete: 1, studentsNotComputable: 0, studentsPending: 0, classAverage: 84.1, passed: 1 }),
  getAttendanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: { sessions: 1, present: 1, absent: 1, excused: 0, attendanceRate: 50 }, FINALS: { sessions: 0, present: 0, absent: 0, excused: 0, attendanceRate: null } }, trend: [] }),
  getPerformanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: { classAverage: 84.1 }, FINALS: { classAverage: null }, OVERALL: { classAverage: null } }, distribution: [{ label: '2.0–2.4', count: 1 }], top: [{ studentId: 's1', fullName: 'Bautista, Ana', percentage: 84.1, grade: 2.1 }], bottom: [], incomplete: [] }),
  getRecentActivity: vi.fn().mockResolvedValue([{ id: 'a', action: 'X', message: 'Took attendance', at: '2026-11-22T00:00:00Z' }]),
}));
vi.mock('../services/studentsApi', () => ({
  listStudents: vi.fn().mockResolvedValue({ items: [{ id: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', firstName: 'Ana', lastName: 'Bautista', course: 'BSIT', yearLevel: 1, section: 'A', enrollmentStatus: 'ENROLLED', archivedAt: null }], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
  getStudentFacets: vi.fn().mockResolvedValue({ courses: ['BSIT'], sections: ['A'], yearLevels: [1] }),
}));
vi.mock('../services/attendanceApi', () => ({
  getSessionRecords: vi.fn().mockResolvedValue({ session: { id: 'a1', sessionDate: '2026-09-01', period: 'MIDTERM', description: null, revision: 0, counts: { present: 1, absent: 1, excused: 0, total: 2 }, attendanceRate: 50 }, records: rows }),
}));
vi.mock('../services/assessmentsApi', () => ({
  getScoreSheet: vi.fn().mockResolvedValue({ assessment: { id: 'q1', title: 'Quiz 1', period: 'MIDTERM', date: '2026-09-10', maxScore: 20, status: 'PUBLISHED', revision: 0, stats }, rows }),
}));
vi.mock('../services/gradingApi', () => ({
  getClassGrades: vi.fn().mockResolvedValue({ period: 'MIDTERM', class: { id: 'c1' }, configuration, summary: { totalStudents: 1, complete: 1, incomplete: 0, notComputable: 0, dropped: 0, lapsed: 0, pending: 0, averagePercentage: 84.1, highestGrade: 2.1, lowestGrade: 2.1, passed: 1, distribution: [] }, rows: [gradeRow] }),
  getStudentGrade: vi.fn().mockResolvedValue({ period: 'MIDTERM', configuration, class: { id: 'c1', subjectCode: 'IT 101', subjectTitle: 'Intro', section: 'A', schoolYear: '2026-2027', semester: 'FIRST' }, grade: { ...gradeRow, student: { id: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', course: 'BSIT', yearLevel: 1, section: 'A' } } }),
  getConfiguration: vi.fn().mockResolvedValue(fullConfig),
  getConfigurationVersions: vi.fn().mockResolvedValue([fullConfig]),
}));

async function expectNoViolations(container) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: {
      'color-contrast': { enabled: false }, // needs a real layout engine
      region: { enabled: false }, // fragments render outside landmarks in isolated tests
    },
  });
  const problems = results.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(problems).toEqual([]);
}

beforeEach(() => {
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
});

describe('accessibility (axe)', () => {
  it('login page', async () => {
    vi.mocked(authApi.restoreSession).mockRejectedValue(new Error('none'));
    const { container } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Welcome back' });
    await expectNoViolations(container);
  });

  it.each([
    ['dashboard', '/', () => screen.findByRole('link', { name: /Total students/ })],
    ['students list', '/students', () => screen.findByRole('link', { name: 'Bautista, Ana' })],
    ['attendance taking', '/attendance/a1', () => screen.findByRole('radiogroup', { name: /Bautista, Ana/ })],
    ['score entry', '/quizzes/q1', () => screen.findByLabelText('Score for Bautista, Ana')],
    ['grading sheet', '/grading', () => screen.findByRole('link', { name: 'Bautista, Ana' })],
    ['grade report', '/grading/midterm/student/s1?classId=c1', () => screen.findByRole('heading', { name: 'Bautista, Ana' })],
    ['grading criteria', '/grading/settings', () => screen.findByRole('heading', { name: /version 1/ })],
    ['manage profile', '/profile', () => screen.findByRole('heading', { name: 'Change password' })],
    ['settings', '/settings', () => screen.findByRole('switch', { name: 'Use a working class' })],
  ])('%s', async (_name, path, ready) => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
    const { container } = renderApp(path);
    await ready();
    await expectNoViolations(container);
  });
});

describe('crash screens', () => {
  it('a page that throws shows a recovery screen instead of a blank page', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() {
      throw new Error('boom');
    }
    const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <RouteErrorPage /> }]);
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument(); // no technical details shown
    spy.mockRestore();
  });

  it('the app-level boundary catches errors outside the router', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() {
      throw new Error('provider failure');
    }
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    spy.mockRestore();
  });
});
