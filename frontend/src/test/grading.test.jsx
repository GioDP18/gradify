import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as gradingApi from '../services/gradingApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/gradingApi', () => ({
  getClassGrades: vi.fn(),
  getStudentGrade: vi.fn(),
  getStudentGradesAcrossClasses: vi.fn(),
  recalculateClass: vi.fn(),
  recalculateStudent: vi.fn(),
  getConfiguration: vi.fn(),
  getConfigurationVersions: vi.fn(),
  saveConfiguration: vi.fn(),
  exportClassGrades: vi.fn(),
  exportStudentReport: vi.fn(),
  getGradeShare: vi.fn().mockResolvedValue({ share: null, student: { fullName: 'Bautista, Ana', email: null }, emailAvailable: false }),
}));

const components = (a, w, p, e) => [
  { key: 'ATTENDANCE', label: 'Attendance', weight: 10, percentage: a, weightedContribution: a * 0.1, rawScore: 9, maxScore: 10, present: 9, absent: 1, excused: 0 },
  { key: 'WRITTEN', label: 'Written Tasks/Quizzes', weight: 30, percentage: w, weightedContribution: w * 0.3, rawScore: w, maxScore: 100 },
  { key: 'PERFORMANCE', label: 'Performance Tasks/Assignments', weight: 20, percentage: p, weightedContribution: p * 0.2, rawScore: p, maxScore: 100 },
  { key: 'EXAM', label: 'Exam (Mid-term)', weight: 40, percentage: e, weightedContribution: e === null ? null : e * 0.4, rawScore: e ?? 0, maxScore: 100 },
];

const configuration = {
  version: 1,
  periodWeights: { MIDTERM: 40, FINALS: 60 },
  periods: {
    MIDTERM: { label: 'Midterm Grade', components: components(0, 0, 0, 0).map(({ key, label, weight }) => ({ key, label, weight })) },
    FINALS: { label: 'Final Grade', components: components(0, 0, 0, 0).map(({ key, label, weight }) => ({ key, label: key === 'EXAM' ? 'Exam (Final Exam)' : label, weight })) },
  },
  passingGrade: 3,
};

const ana = {
  studentId: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', period: 'MIDTERM', current: true, calcStatus: 'CURRENT',
  completionStatus: 'COMPLETE', percentage: 84.1, roundedPercent: 84, grade: 2.1, remarks: 'Very Good', components: components(90, 85, 88, 80), missingItems: [], emptyComponents: [],
};
const ben = {
  studentId: 's2', studentNumber: '2026-002', fullName: 'Cruz, Ben', period: 'MIDTERM', current: true, calcStatus: 'CURRENT',
  completionStatus: 'INCOMPLETE', percentage: null, roundedPercent: null, grade: null, remarks: 'INC', components: components(100, 100, 100, null),
  missingItems: [{ component: 'EXAM', componentLabel: 'Exam (Mid-term)', id: 'e1', title: 'Midterm Exam' }], emptyComponents: [],
};
const carla = {
  studentId: 's3', studentNumber: '2026-003', fullName: 'Dizon, Carla', period: 'MIDTERM', current: false, calcStatus: 'FAILED',
  completionStatus: null, percentage: null, grade: null, remarks: null, components: components(100, 100, 100, 100), missingItems: [], emptyComponents: [],
  lastKnown: { grade: 1.0, remarks: 'Excellent' },
};
const summary = {
  totalStudents: 3, complete: 1, incomplete: 1, notComputable: 0, dropped: 0, lapsed: 0, pending: 1,
  averagePercentage: 84.1, highestGrade: 2.1, lowestGrade: 2.1, passed: 1,
  distribution: [{ label: '2.0–2.4', count: 1 }, { label: 'INC', count: 1 }],
};
const sheet = { period: 'MIDTERM', class: { id: 'c1' }, configuration, summary, rows: [ana, ben, carla] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(gradingApi.getClassGrades).mockResolvedValue(sheet);
});

describe('grading sheet', () => {
  it('shows engine results with official component columns, INC details, and summary', async () => {
    renderApp('/grading');
    expect(await screen.findByRole('link', { name: 'Bautista, Ana' })).toBeInTheDocument();
    expect(gradingApi.getClassGrades).toHaveBeenCalledWith('midterm', 'c1');

    for (const header of ['Attendance (10%)', 'Written Tasks/Quizzes (30%)', 'Performance Tasks/Assignments (20%)', 'Exam (Mid-term) (40%)']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header.replace(/[()]/g, '\\$&')) })).toBeInTheDocument();
    }
    const anaRow = screen.getByRole('link', { name: 'Bautista, Ana' }).closest('tr');
    expect(within(anaRow).getByText('84.10%')).toBeInTheDocument();
    expect(within(anaRow).getByText('2.1')).toBeInTheDocument();
    expect(within(anaRow).getByText('Very Good')).toBeInTheDocument();

    const benRow = screen.getByRole('link', { name: 'Cruz, Ben' }).closest('tr');
    expect(within(benRow).getByText('INC')).toBeInTheDocument();
    expect(within(benRow).getByText('Missing: Midterm Exam')).toBeInTheDocument();

    expect(screen.getByText(/1 grade is pending recalculation/)).toBeInTheDocument();
  });

  it('never shows a pending grade as current (last known value hidden)', async () => {
    renderApp('/grading');
    const carlaRow = (await screen.findByRole('link', { name: 'Dizon, Carla' })).closest('tr');
    expect(within(carlaRow).getByText('Pending (retrying)')).toBeInTheDocument();
    expect(within(carlaRow).queryByText('1.0')).not.toBeInTheDocument();
    expect(within(carlaRow).queryByText('Excellent')).not.toBeInTheDocument();
  });

  it('switches to the Final Grade tab and requests the overall sheet', async () => {
    renderApp('/grading');
    await screen.findByRole('link', { name: 'Bautista, Ana' });
    await userEvent.click(screen.getByRole('button', { name: 'Final Grade' }));
    await waitFor(() => expect(gradingApi.getClassGrades).toHaveBeenLastCalledWith('overall', 'c1'));
  });

  it('filters by result and sorts by grade', async () => {
    renderApp('/grading');
    await screen.findByRole('link', { name: 'Bautista, Ana' });
    await userEvent.selectOptions(screen.getByLabelText('Filter by result'), 'INCOMPLETE');
    expect(screen.queryByRole('link', { name: 'Bautista, Ana' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cruz, Ben' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by result'), '');
    await userEvent.type(screen.getByLabelText('Search students'), 'dizon');
    expect(within(screen.getByRole('table')).getAllByRole('link').map((l) => l.textContent).filter(Boolean)).toEqual(['Dizon, Carla']); // name links (the "View calculation" links are icons)
  });

  it('recalculates, exports CSV and Excel through the backend', async () => {
    vi.mocked(gradingApi.recalculateClass).mockResolvedValue({ recalculated: 3, failed: 0 });
    vi.mocked(gradingApi.exportClassGrades).mockResolvedValue();
    renderApp('/grading');
    await screen.findByRole('link', { name: 'Bautista, Ana' });
    await userEvent.click(screen.getAllByRole('button', { name: /Recalculate/ })[0]);
    expect(await screen.findByText('Recalculated 3 students.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'CSV' }));
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(gradingApi.exportClassGrades).toHaveBeenCalledWith('midterm', 'c1', 'csv');
    expect(gradingApi.exportClassGrades).toHaveBeenCalledWith('midterm', 'c1', 'xlsx');
  });

  it('links each student to how their grade was computed', async () => {
    renderApp('/grading');
    const anaRow = (await screen.findByRole('link', { name: 'Bautista, Ana' })).closest('tr');
    expect(within(anaRow).getByRole('link', { name: 'View calculation for Bautista, Ana' })).toHaveAttribute('href', '/grading/midterm/student/s1?classId=c1');
    expect(within(anaRow).queryByRole('button', { name: /Recalculate/ })).not.toBeInTheDocument(); // recalculating one student lives on the report
  });

  it('prints the class sheet', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderApp('/grading');
    await screen.findByRole('link', { name: 'Bautista, Ana' });
    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });
});

describe('individual grade report', () => {
  it('shows the transparent breakdown and the final result', async () => {
    vi.mocked(gradingApi.getStudentGrade).mockResolvedValue({
      period: 'MIDTERM',
      class: { id: 'c1', subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST' },
      configuration,
      grade: { ...ana, student: { id: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', course: 'BSIT', yearLevel: 1, section: 'A' }, lastCalculatedAt: '2026-11-22T00:00:00Z' },
    });
    renderApp('/grading/midterm/student/s1?classId=c1');
    expect(await screen.findByRole('heading', { name: 'Bautista, Ana' })).toBeInTheDocument();
    expect(gradingApi.getStudentGrade).toHaveBeenCalledWith('midterm', 'c1', 's1');

    const breakdown = screen.getByRole('region', { name: 'Midterm grade' });
    const exam = within(breakdown).getByRole('rowheader', { name: 'Exam (Mid-term)' }).closest('tr');
    expect(within(exam).getByText('80.00%')).toBeInTheDocument();
    expect(within(exam).getByText('40%')).toBeInTheDocument();
    expect(within(exam).getByText('32')).toBeInTheDocument();
    expect(within(breakdown).getByText('Present 9 · Excused 0 · Absent 1')).toBeInTheDocument();

    const result = screen.getByRole('region', { name: 'Midterm result' });
    expect(within(result).getByText('84.10%')).toBeInTheDocument();
    expect(within(result).getByText('84%')).toBeInTheDocument();
    expect(within(result).getByText('2.1')).toBeInTheDocument();

    vi.mocked(gradingApi.exportStudentReport).mockResolvedValue();
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(gradingApi.exportStudentReport).toHaveBeenCalledWith('midterm', 'c1', 's1', 'xlsx');
  });

  it('recalculates this student, showing the calculating animation until the new figures are ready', async () => {
    const report = (percentage) => ({
      period: 'MIDTERM',
      class: { id: 'c1', subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST' },
      configuration,
      grade: { ...ana, percentage, student: { id: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', course: 'BSIT', yearLevel: 1, section: 'A' } },
    });
    vi.mocked(gradingApi.getStudentGrade).mockResolvedValue(report(84.1));
    let finish;
    vi.mocked(gradingApi.recalculateStudent).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ recalculated: 1, failed: 0 }); }));
    renderApp('/grading/midterm/student/s1?classId=c1');
    expect(await screen.findByRole('region', { name: 'Midterm result' })).toHaveTextContent('84.10%');

    await userEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    expect(gradingApi.recalculateStudent).toHaveBeenCalledWith('c1', 's1');
    expect(screen.getByRole('status')).toHaveTextContent('Calculating Bautista, Ana’s grade');
    expect(screen.queryByRole('region', { name: 'Midterm result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeDisabled();

    vi.mocked(gradingApi.getStudentGrade).mockResolvedValue(report(90));
    finish();
    expect(await screen.findByRole('region', { name: 'Midterm result' }, { timeout: 3000 })).toHaveTextContent('90.00%');
    expect(screen.getByText('Recalculated Bautista, Ana.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeEnabled();
  });

  it('lists lacking requirements and the INC deadline', async () => {
    vi.mocked(gradingApi.getStudentGrade).mockResolvedValue({
      period: 'OVERALL',
      class: { id: 'c1', subjectCode: 'IT 101', subjectTitle: 'Intro', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST' },
      configuration,
      grade: {
        ...ben, period: 'OVERALL', components: [], incDeadline: '2027-12-18T00:00:00.000Z',
        missingItems: [{ period: 'MIDTERM', component: 'EXAM', componentLabel: 'Exam (Mid-term)', id: 'e1', title: 'Midterm Exam' }],
        periodResults: { MIDTERM: { status: 'INCOMPLETE', percentage: null, grade: null, weight: 40, weightedContribution: null }, FINALS: { status: 'COMPLETE', percentage: 100, grade: 1, weight: 60, weightedContribution: 60 } },
        periods: { MIDTERM: ben, FINALS: { ...ana, period: 'FINALS' } },
        student: { id: 's2', studentNumber: '2026-002', fullName: 'Cruz, Ben', course: 'BSIT', yearLevel: 1, section: 'A' },
      },
    });
    renderApp('/grading/overall/student/s2?classId=c1');
    expect(await screen.findByText('Lacking requirements')).toBeInTheDocument();
    expect(screen.getByText('Midterm — Midterm Exam (Exam (Mid-term))')).toBeInTheDocument();
    expect(screen.getByText('Incomplete (INC)')).toBeInTheDocument();
    expect(screen.getByText(/Dec 18, 2027/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Final grade computation' })).toHaveTextContent('60');
  });
});

describe('grading criteria settings', () => {
  const admin = { id: 'a1', name: 'Registrar Admin', email: 'admin@evsu.edu.ph', role: 'ADMIN', status: 'ACTIVE' };
  const activeConfig = {
    id: 'cfg1', version: 1, isActive: true, effectiveDate: '2026-11-01T00:00:00Z', notes: null,
    periodWeights: { MIDTERM: 40, FINALS: 60 },
    periods: {
      MIDTERM: { label: 'Midterm Grade', components: [
        { key: 'ATTENDANCE', label: 'Attendance', weight: 10, source: 'attendance' },
        { key: 'WRITTEN', label: 'Written Tasks/Quizzes', weight: 30, source: 'writtenQuizzes' },
        { key: 'PERFORMANCE', label: 'Performance Tasks/Assignments', weight: 20, source: 'performanceActivities' },
        { key: 'EXAM', label: 'Exam (Mid-term)', weight: 40, source: 'examinations' },
      ] },
      FINALS: { label: 'Final Grade', components: [
        { key: 'ATTENDANCE', label: 'Attendance', weight: 10, source: 'attendance' },
        { key: 'WRITTEN', label: 'Written Tasks/Quizzes', weight: 30, source: 'writtenQuizzes' },
        { key: 'PERFORMANCE', label: 'Performance Tasks/Assignments', weight: 20, source: 'performanceActivities' },
        { key: 'EXAM', label: 'Exam (Final Exam)', weight: 40, source: 'examinations' },
      ] },
    },
    gradeConversion: { passingGrade: 3, table: [{ minPercent: 95, maxPercent: 100, grade: 1 }, { minPercent: 75, maxPercent: 75, grade: 3 }], remarks: [{ minGrade: 1, maxGrade: 1.4, label: 'Excellent' }] },
    incompleteRule: { complianceMonths: 12, lapseGrade: 5 },
    createdAt: '2026-11-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.mocked(gradingApi.getConfiguration).mockResolvedValue(activeConfig);
    vi.mocked(gradingApi.getConfigurationVersions).mockResolvedValue([activeConfig]);
  });

  it('lives under Settings; instructors see the shared criteria read-only', async () => {
    const { router } = renderApp('/grading/settings'); // old address still works
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/grading'));
    expect(await screen.findByRole('heading', { name: /version 1/ })).toBeInTheDocument();
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
    expect(screen.getByText(/set by the administrator and apply to all classes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit weights/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Midterm weight/)).not.toBeInTheDocument();
  });

  it('the administrator: weights must total 100%, then a confirmed save publishes a version for everyone', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(admin);
    vi.mocked(gradingApi.saveConfiguration).mockResolvedValue({ configuration: { ...activeConfig, version: 2 }, classesToRecalculate: 12 });
    renderApp('/settings/grading');
    await userEvent.click(await screen.findByRole('button', { name: /Edit weights/ }));

    const midterm = screen.getByLabelText('Midterm weight (%)');
    await userEvent.clear(midterm);
    await userEvent.type(midterm, '50');
    expect(screen.getByText('Total 110% (must be 100%)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as new version' })).toBeDisabled();

    const finals = screen.getByLabelText('Finals weight (%)');
    await userEvent.clear(finals);
    await userEvent.type(finals, '50');
    expect(screen.getByRole('button', { name: 'Save as new version' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Save as new version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activate new grading criteria?' });
    expect(dialog).toHaveTextContent('for every instructor');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(gradingApi.saveConfiguration).toHaveBeenCalled());
    const sent = vi.mocked(gradingApi.saveConfiguration).mock.calls[0][0];
    expect(sent.periodWeights).toEqual({ MIDTERM: 50, FINALS: 50 });
    expect(sent.periods.MIDTERM.components.map((c) => [c.key, c.source, c.weight])).toEqual([
      ['ATTENDANCE', 'attendance', 10], ['WRITTEN', 'writtenQuizzes', 30], ['PERFORMANCE', 'performanceActivities', 20], ['EXAM', 'examinations', 40],
    ]);
    expect(await screen.findByText(/Criteria version 2 is now active for every class. Grades in 12 classes/)).toBeInTheDocument();
  });

  it('shows server validation errors', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(admin);
    vi.mocked(gradingApi.saveConfiguration).mockRejectedValue(new ApiClientError({ status: 422, code: 'VALIDATION_ERROR', message: 'invalid', details: [{ field: 'periodWeights', message: 'Midterm and Finals weights must add up to 100%' }] }));
    renderApp('/settings/grading');
    await userEvent.click(await screen.findByRole('button', { name: /Edit weights/ }));
    const label = screen.getByLabelText('Midterm component 1 label');
    await userEvent.type(label, ' (class sessions)');
    await userEvent.click(screen.getByRole('button', { name: 'Save as new version' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save and recalculate' }));
    expect(await screen.findByText('Midterm and Finals weights must add up to 100%')).toBeInTheDocument();
  });
});
