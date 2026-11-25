import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as gradingApi from '../services/gradingApi';
import * as publicApi from '../services/publicApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/publicApi', () => ({ getJoinInfo: vi.fn(), selfEnroll: vi.fn(), getSharedGrades: vi.fn() }));
vi.mock('../services/gradingApi', () => ({
  getClassGrades: vi.fn(), getStudentGrade: vi.fn(), getStudentGradesAcrossClasses: vi.fn(), recalculateClass: vi.fn(), recalculateStudent: vi.fn(),
  getConfiguration: vi.fn(), getConfigurationVersions: vi.fn(), saveConfiguration: vi.fn(), exportClassGrades: vi.fn(), exportStudentReport: vi.fn(),
  setGradeShareMany: vi.fn(), stopGradeShareMany: vi.fn(),
  getGradeShare: vi.fn(), setGradeShare: vi.fn(), stopGradeShare: vi.fn(), emailGradeShare: vi.fn(),
}));

const TOKEN = 'WywuQIW5gxPchtx1gDaJJmDD';
const comps = [
  { key: 'ATTENDANCE', label: 'Attendance', weight: 10, percentage: 90, weightedContribution: 9, rawScore: 9, maxScore: 10, present: 9, absent: 1, excused: 0 },
  { key: 'EXAM', label: 'Exam (Mid-term)', weight: 40, percentage: 80, weightedContribution: 32, rawScore: 80, maxScore: 100 },
];
const configuration = { version: 1, periodWeights: { MIDTERM: 40, FINALS: 60 }, periods: {}, passingGrade: 3 };
const cls = { subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST' };
const student = { studentNumber: '2026-001', fullName: 'Bautista, Ana', course: 'BSIT', yearLevel: 1, section: 'A' };
const row = (period, percentage, grade) => ({
  studentNumber: '2026-001', fullName: 'Bautista, Ana', period, current: true, calcStatus: 'CURRENT', completionStatus: 'COMPLETE',
  percentage, roundedPercent: Math.round(percentage), grade, remarks: 'Very Good', components: comps, missingItems: [], emptyComponents: [],
});
const midterm = row('MIDTERM', 84.1, 2.1);
const finals = row('FINALS', 89.8, 1.5);

const state = (share, extra = {}) => ({ share, student: { fullName: 'Bautista, Ana', email: 'ana@evsu.edu.ph' }, emailAvailable: true, ...extra });
const open = { token: TOKEN, scope: 'all', expiresAt: null, sharedAt: '2026-11-26T01:00:00Z', emailedAt: null, expired: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(gradingApi.getStudentGrade).mockResolvedValue({ period: 'MIDTERM', class: { id: 'c1', ...cls }, configuration, grade: { ...midterm, studentId: 's1', student: { id: 's1', ...student } } });
});

describe('instructor: sharing a grading sheet with the student', () => {
  const openDialog = async (name = 'Share with student') => {
    renderApp('/grading/midterm/student/s1?classId=c1');
    // Wait for the report itself: while it loads, the placeholder shows the same button, disabled.
    // (The first render also downloads the page's code, which can take a moment.)
    await screen.findByRole('heading', { name: 'Bautista, Ana' }, { timeout: 10000 });
    await userEvent.click(await screen.findByRole('button', { name }));
    return screen.findByRole('dialog', { name: 'Share grading sheet' });
  };

  it('shares for the chosen time, then offers the link and the email button', async () => {
    vi.mocked(gradingApi.getGradeShare).mockResolvedValue(state(null));
    vi.mocked(gradingApi.setGradeShare).mockResolvedValue(state({ ...open, expiresAt: '2026-11-29T01:00:00Z' }));
    vi.mocked(gradingApi.emailGradeShare).mockResolvedValue(state({ ...open, expiresAt: '2026-11-29T01:00:00Z', emailedAt: '2026-11-26T02:00:00Z' }));
    const dialog = await openDialog();

    expect(await within(dialog).findByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).queryByLabelText('Private link')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '3 days' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Share with student' }));
    expect(gradingApi.setGradeShare).toHaveBeenCalledWith('c1', 's1', 72, 'all');

    expect(await within(dialog).findByLabelText('Private link')).toHaveValue(`${window.location.origin}/my-grades/${TOKEN}`);
    expect(within(dialog).getByRole('status')).toHaveTextContent('The student can view this sheet');
    expect(within(dialog).getByText('Sends the link to ana@evsu.edu.ph.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to student’s email' }));
    expect(gradingApi.emailGradeShare).toHaveBeenCalledWith('c1', 's1');
    expect(await screen.findByText('Link sent to ana@evsu.edu.ph.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send to student’s email again' })).toBeInTheDocument();
  });

  it('can be left open with no time limit, and stopped', async () => {
    vi.mocked(gradingApi.getGradeShare).mockResolvedValue(state(null));
    vi.mocked(gradingApi.setGradeShare).mockResolvedValue(state(open));
    vi.mocked(gradingApi.stopGradeShare).mockResolvedValue(state(null));
    const dialog = await openDialog();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'No time limit' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Share with student' }));
    expect(gradingApi.setGradeShare).toHaveBeenCalledWith('c1', 's1', null, 'all');
    expect(await within(dialog).findByText(/Open with no time limit/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop sharing' }));
    await waitFor(() => expect(gradingApi.stopGradeShare).toHaveBeenCalledWith('c1', 's1'));
    await waitFor(() => expect(within(dialog).queryByLabelText('Private link')).not.toBeInTheDocument());
  });

  it('marks the button while shared, and explains when the email cannot be sent', async () => {
    vi.mocked(gradingApi.getGradeShare).mockResolvedValue(state(open, { student: { fullName: 'Bautista, Ana', email: null } }));
    const dialog = await openDialog('Shared with student');
    expect(await within(dialog).findByRole('button', { name: 'Send to student’s email' })).toBeDisabled();
    expect(within(dialog).getByText(/no email address on record/)).toBeInTheDocument();
  });

  it('shows a share whose time has ended as ended, without the link', async () => {
    vi.mocked(gradingApi.getGradeShare).mockResolvedValue(state({ ...open, expiresAt: '2026-11-20T01:00:00Z', expired: true }));
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Viewing time has ended');
    expect(within(dialog).queryByLabelText('Private link')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('can share one grade only, and starts from what is shared now', async () => {
    vi.mocked(gradingApi.getGradeShare).mockResolvedValue(state({ ...open, scope: 'midterm' }));
    vi.mocked(gradingApi.setGradeShare).mockResolvedValue(state({ ...open, scope: 'overall' }));
    const dialog = await openDialog('Shared with student');
    const what = await within(dialog).findByRole('group', { name: 'What to share' });
    expect(within(what).getByRole('button', { name: 'Midterm' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Showing: Midterm only.');

    await userEvent.click(within(what).getByRole('button', { name: 'Final Grade' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(gradingApi.setGradeShare).toHaveBeenCalledWith('c1', 's1', 168, 'overall');
    expect(await within(dialog).findByText('Showing: Final Grade only.')).toBeInTheDocument();
  });
});

describe('instructor: sharing with selected students from the class sheet', () => {
  const sheetRow = (id, fullName, shared = false) => ({ ...midterm, studentId: id, fullName, studentNumber: `2026-00${id.slice(1)}`, shared });
  const summary = { totalStudents: 3, complete: 3, incomplete: 0, notComputable: 0, dropped: 0, lapsed: 0, pending: 0, averagePercentage: 84.1, highestGrade: 2.1, lowestGrade: 2.1, passed: 3, distribution: [] };
  const fullConfig = { ...configuration, periods: { MIDTERM: { label: 'Midterm Grade', components: comps.map(({ key, label, weight }) => ({ key, label, weight })) }, FINALS: { label: 'Final Grade', components: [] } } };
  beforeEach(() => {
    vi.mocked(gradingApi.getClassGrades).mockResolvedValue({
      period: 'MIDTERM', class: { id: 'c1' }, configuration: fullConfig, summary, emailAvailable: true,
      rows: [sheetRow('s1', 'Bautista, Ana'), sheetRow('s2', 'Cruz, Ben'), sheetRow('s3', 'Dizon, Carla', true)],
    });
  });

  it('offers sharing only once students are selected, then shares and emails them', async () => {
    vi.mocked(gradingApi.setGradeShareMany).mockResolvedValue({ shared: 2, expiresAt: null, emailRequested: true, emailAvailable: true, emailed: 1, noEmail: ['Cruz, Ben'], emailFailed: [] });
    renderApp('/grading');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Bautista, Ana' }, { timeout: 4000 }));
    expect(screen.getByRole('button', { name: 'Share with 1 student' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Cruz, Ben' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share with 2 students' }));

    const dialog = await screen.findByRole('dialog', { name: 'Share with 2 students' });
    expect(within(dialog).queryByRole('button', { name: /Stop sharing/ })).not.toBeInTheDocument(); // neither has a link yet
    await userEvent.click(within(within(dialog).getByRole('group', { name: 'What to share' })).getByRole('button', { name: 'Midterm' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'No time limit' }));
    await userEvent.click(within(dialog).getByLabelText('Also send each student their link by email'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Share with 2 students' }));
    expect(gradingApi.setGradeShareMany).toHaveBeenCalledWith('c1', ['s1', 's2'], { durationHours: null, scope: 'midterm', email: true });

    const done = await within(dialog).findByRole('status');
    expect(done).toHaveTextContent('2 students can now view their own grading sheet');
    expect(done).toHaveTextContent('Showing: Midterm only.');
    expect(done).toHaveTextContent('1 email was sent.');
    expect(done).toHaveTextContent('No email address on record (1)');
    expect(within(done).getByText('Cruz, Ben')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('button', { name: /^Share with/ })).not.toBeInTheDocument();
  });

  it('shows no sharing option with nothing selected, and can stop sharing for a selection', async () => {
    vi.mocked(gradingApi.stopGradeShareMany).mockResolvedValue({ stopped: 3 });
    renderApp('/grading');
    const all = await screen.findByRole('checkbox', { name: 'Select all rows on this page' }, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: /^Share with/ })).not.toBeInTheDocument();
    await userEvent.click(all);
    await userEvent.click(screen.getByRole('button', { name: 'Share with 3 students' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share with 3 students' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop sharing for these students' }));
    await waitFor(() => expect(gradingApi.stopGradeShareMany).toHaveBeenCalledWith('c1', ['s1', 's2', 's3']));
    expect(await screen.findByText('Sharing stopped for 3 students. Their links no longer work.')).toBeInTheDocument();
  });
});

describe('student: the page the shared link opens (no sign-in)', () => {
  beforeEach(() => {
    vi.mocked(authApi.restoreSession).mockRejectedValue(new Error('signed out'));
  });

  it('shows their own sheet and lets them switch periods', async () => {
    vi.mocked(publicApi.getSharedGrades).mockResolvedValue({
      class: cls, student, instructor: 'Maria Santos', configuration, expiresAt: '2026-11-29T01:00:00Z',
      grades: {
        midterm, finals,
        overall: { ...row('OVERALL', 87.52, 1.7), components: [], periods: { MIDTERM: midterm, FINALS: finals }, periodResults: { MIDTERM: { percentage: 84.1, weightedContribution: 33.64 }, FINALS: { percentage: 89.8, weightedContribution: 53.88 } } },
      },
    });
    renderApp(`/my-grades/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Bautista, Ana' })).toBeInTheDocument();
    expect(publicApi.getSharedGrades).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole('heading', { name: 'Your grading sheet' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Midterm result' })).getByText('84.10%')).toBeInTheDocument();
    expect(screen.getByText(/Talk to your instructor, Maria Santos/)).toBeInTheDocument();
    expect(screen.getByText(/You can view this page until/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalculate|Share/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Final Grade' }));
    expect(within(screen.getByRole('region', { name: 'Final result' })).getByText('87.52%')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Finals grade (60% of the final grade)' })).toBeInTheDocument();
  });

  it('shows one grade without period tabs when only that was shared', async () => {
    vi.mocked(publicApi.getSharedGrades).mockResolvedValue({ class: cls, student, instructor: 'Maria Santos', configuration, expiresAt: null, scope: 'finals', grades: { finals } });
    renderApp(`/my-grades/${TOKEN}`);
    expect(await screen.findByRole('region', { name: 'Finals result' })).toHaveTextContent('89.80%');
    expect(screen.queryByRole('group', { name: 'Grading period' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Midterm result' })).not.toBeInTheDocument();
  });

  it('explains an expired or invalid link', async () => {
    vi.mocked(publicApi.getSharedGrades).mockRejectedValue(new ApiClientError({ status: 410, code: 'LINK_EXPIRED', message: 'This link has expired. Ask your instructor to share your grading sheet again.' }));
    renderApp(`/my-grades/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Ask your instructor to share your grading sheet again.');
  });
});
