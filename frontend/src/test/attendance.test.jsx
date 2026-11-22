import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as attendanceApi from '../services/attendanceApi';
import { ApiClientError } from '../services/apiClient';
import { formatPercent } from '../utils/format';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/attendanceApi', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionRecords: vi.fn(),
  saveSessionRecords: vi.fn(),
  getAttendanceSummary: vi.fn(),
}));

const session = {
  id: 'a1', classId: 'c1', sessionDate: '2026-09-01', period: 'MIDTERM', description: 'Lecture 1', revision: 0,
  counts: { present: 3, absent: 0, excused: 0, total: 3 }, attendanceRate: 100,
};
const records = [
  { studentId: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', status: 'PRESENT', archived: false, enrollmentStatus: 'ENROLLED' },
  { studentId: 's2', studentNumber: '2026-002', fullName: 'Cruz, Ben', status: 'PRESENT', archived: false, enrollmentStatus: 'ENROLLED' },
  { studentId: 's3', studentNumber: '2026-003', fullName: 'Dizon, Carla', status: 'PRESENT', archived: false, enrollmentStatus: 'DROPPED' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(attendanceApi.listSessions).mockResolvedValue({ items: [session], meta: { page: 1, limit: 25, total: 1, totalPages: 1 } });
  vi.mocked(attendanceApi.getSessionRecords).mockResolvedValue({ session, records });
});

describe('formatPercent (display only)', () => {
  it('formats without trailing zeros and handles missing values', () => {
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(66.66666)).toBe('66.67%');
    expect(formatPercent(50.5)).toBe('50.5%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('attendance sessions page', () => {
  it('lists sessions for the working class and period', async () => {
    renderApp('/attendance');
    expect(await screen.findByRole('link', { name: 'Tue, Sep 1, 2026' })).toBeInTheDocument();
    expect(attendanceApi.listSessions).toHaveBeenCalledWith(expect.objectContaining({ classId: 'c1', period: 'MIDTERM' }));

    await userEvent.click(screen.getByRole('button', { name: 'Finals' }));
    await waitFor(() => expect(attendanceApi.listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'FINALS' })));
  });

  it('creates a session (everyone present by default) and opens it', async () => {
    vi.mocked(attendanceApi.createSession).mockResolvedValue({ ...session, id: 'a2' });
    const { router } = renderApp('/attendance');
    await userEvent.click(await screen.findByRole('button', { name: /New session/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New attendance session' });
    expect(dialog).toHaveTextContent('will start as Present');
    expect(within(dialog).getByLabelText(/Grading period/)).toHaveValue('MIDTERM');
    const date = within(dialog).getByLabelText(/Date/);
    await userEvent.clear(date);
    await userEvent.type(date, '2026-09-02');
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Lab');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and take attendance' }));

    await waitFor(() => expect(attendanceApi.createSession).toHaveBeenCalledWith({ classId: 'c1', period: 'MIDTERM', sessionDate: '2026-09-02', description: 'Lab' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/attendance/a2'));
  });

  it('shows a duplicate-session conflict in the form', async () => {
    vi.mocked(attendanceApi.createSession).mockRejectedValue(new ApiClientError({ status: 409, code: 'CONFLICT', message: 'An attendance session for 2026-09-01 (Midterm) already exists for this class' }));
    renderApp('/attendance');
    await userEvent.click(await screen.findByRole('button', { name: /New session/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New attendance session' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and take attendance' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
  });

  it('deletes a session after confirmation', async () => {
    vi.mocked(attendanceApi.deleteSession).mockResolvedValue();
    renderApp('/attendance');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete session 2026-09-01' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this attendance session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete session' }));
    await waitFor(() => expect(attendanceApi.deleteSession).toHaveBeenCalledWith('a1'));
  });

  it('shows the per-student summary for the period', async () => {
    vi.mocked(attendanceApi.getAttendanceSummary).mockResolvedValue({
      students: [{ studentId: 's1', classId: 'c1', period: 'MIDTERM', studentNumber: '2026-001', fullName: 'Bautista, Ana', present: 1, absent: 1, excused: 1, total: 3, attendanceRate: 66.666 }],
      periods: [{ classId: 'c1', period: 'MIDTERM', sessions: 3, present: 1, absent: 1, excused: 1, total: 3, attendanceRate: 66.666 }],
    });
    renderApp('/attendance?view=summary');
    expect(await screen.findByRole('link', { name: 'Bautista, Ana' })).toBeInTheDocument();
    expect(screen.getAllByText('66.67%').length).toBeGreaterThan(0);
  });
});

describe('taking attendance', () => {
  it('marks students, highlights unsaved changes, and saves only the changes', async () => {
    vi.mocked(attendanceApi.saveSessionRecords).mockResolvedValue({
      changed: 2, revision: 1,
      session: { ...session, revision: 1, counts: { present: 1, absent: 1, excused: 1, total: 3 }, attendanceRate: 66.67 },
      records: [{ ...records[0], status: 'ABSENT' }, { ...records[1], status: 'EXCUSED' }, records[2]],
    });
    renderApp('/attendance/a1');
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    expect(screen.getByText('DRP')).toBeInTheDocument();

    const ana = screen.getByRole('radiogroup', { name: 'Attendance for Bautista, Ana' });
    await userEvent.click(within(ana).getByLabelText('Absent'));
    const ben = screen.getByRole('radiogroup', { name: 'Attendance for Cruz, Ben' });
    await userEvent.click(within(ben).getByLabelText('Excused'));

    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(screen.getAllByText('Unsaved')).toHaveLength(2);
    expect(screen.getByText('Absent 1')).toBeInTheDocument();

    // Setting a student back to their saved status removes it from the changes.
    await userEvent.click(within(ben).getByLabelText('Present'));
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    await userEvent.click(within(ben).getByLabelText('Excused'));

    await userEvent.click(screen.getByRole('button', { name: /Save attendance/ }));
    await waitFor(() =>
      expect(attendanceApi.saveSessionRecords).toHaveBeenCalledWith('a1', {
        revision: 0,
        records: [{ studentId: 's1', status: 'ABSENT' }, { studentId: 's2', status: 'EXCUSED' }],
      }),
    );
    expect(await screen.findByText('Attendance saved (2 changes).')).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('bulk-marks selected students', async () => {
    renderApp('/attendance/a1');
    await userEvent.click(await screen.findByLabelText('Select Bautista, Ana'));
    await userEvent.click(screen.getByLabelText('Select Cruz, Ben'));
    const bulk = screen.getByRole('region', { name: 'Bulk actions' });
    await userEvent.click(within(bulk).getByRole('button', { name: 'Absent' }));
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('Absent 2')).toBeInTheDocument();
  });

  it('discards changes after confirmation', async () => {
    renderApp('/attendance/a1');
    const ana = await screen.findByRole('radiogroup', { name: 'Attendance for Bautista, Ana' });
    await userEvent.click(within(ana).getByLabelText('Absent'));
    await userEvent.click(screen.getByRole('button', { name: /Discard/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(within(ana).getByLabelText('Present')).toBeChecked();
  });

  it('warns before navigating away with unsaved changes', async () => {
    const { router } = renderApp('/attendance/a1');
    const ana = await screen.findByRole('radiogroup', { name: 'Attendance for Bautista, Ana' });
    await userEvent.click(within(ana).getByLabelText('Absent'));

    await userEvent.click(screen.getByRole('link', { name: /All sessions/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(router.state.location.pathname).toBe('/attendance/a1');

    await userEvent.click(screen.getByRole('link', { name: /All sessions/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave without saving' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/attendance'));
  });

  it('explains a stale save and offers to reload', async () => {
    vi.mocked(attendanceApi.saveSessionRecords).mockRejectedValue(
      new ApiClientError({ status: 409, code: 'STALE_REVISION', message: 'This attendance was changed elsewhere (another tab or device). Reload to see the latest before saving.' }),
    );
    renderApp('/attendance/a1');
    const ana = await screen.findByRole('radiogroup', { name: 'Attendance for Bautista, Ana' });
    await userEvent.click(within(ana).getByLabelText('Absent'));
    await userEvent.click(screen.getByRole('button', { name: /Save attendance/ }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reload latest/ }));
    await waitFor(() => expect(attendanceApi.getSessionRecords).toHaveBeenCalledTimes(2));
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });
});
