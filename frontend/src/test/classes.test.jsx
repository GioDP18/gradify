import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/dashboardApi', () => ({
  getOverview: vi.fn().mockResolvedValue(null),
  getAttendanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: {}, FINALS: {} }, trend: [] }),
  getPerformanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: {}, FINALS: {}, OVERALL: {} }, distribution: [], top: [], bottom: [], incomplete: [] }),
  getRecentActivity: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/classesApi', () => ({
  listClasses: vi.fn(),
  createClass: vi.fn(),
  updateClass: vi.fn(),
  archiveClass: vi.fn(),
  restoreClass: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
});

async function fillClassForm({ code = 'IT 101', section = 'BSIT-1A', title = 'Introduction to Computing' } = {}) {
  const dialog = await screen.findByRole('dialog', { name: 'New class' });
  const q = within(dialog);
  await userEvent.type(q.getByLabelText(/Subject code/), code);
  await userEvent.type(q.getByLabelText(/Section/), section);
  await userEvent.type(q.getByLabelText(/Subject title/), title);
  await userEvent.selectOptions(q.getByLabelText(/Semester/), 'FIRST');
  await userEvent.type(q.getByLabelText(/Term end date/), '2026-12-18');
  return q;
}

describe('classes page', () => {
  it('shows an empty state with a call to action', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([]);
    renderApp('/classes');
    expect(await screen.findByText('No active classes yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create your first class' })).toBeInTheDocument();
  });

  it('validates the form before submitting', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([]);
    renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: /New class/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New class' });
    const schoolYear = within(dialog).getByLabelText(/School year/);
    await userEvent.clear(schoolYear);
    await userEvent.type(schoolYear, '2026-2028');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create class' }));

    expect(await within(dialog).findByText('Subject code is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Use the format 2026-2027.')).toBeInTheDocument();
    expect(within(dialog).getByText('Select a semester.')).toBeInTheDocument();
    expect(within(dialog).getByText('Term end date is required.')).toBeInTheDocument();
    expect(classesApi.createClass).not.toHaveBeenCalled();
  });

  it('creates a class, refreshes the list, and makes it the working class', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValueOnce([]).mockResolvedValue([sampleClass]);
    vi.mocked(classesApi.createClass).mockResolvedValue(sampleClass);
    renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: /New class/ }));
    const q = await fillClassForm();
    await userEvent.click(q.getByRole('button', { name: 'Create class' }));

    await waitFor(() => expect(classesApi.createClass).toHaveBeenCalled());
    expect(vi.mocked(classesApi.createClass).mock.calls[0][0]).toMatchObject({
      subjectCode: 'IT 101', section: 'BSIT-1A', semester: 'FIRST', termEndDate: '2026-12-18',
    });
    expect(await screen.findByText('IT 101 · BSIT-1A created.')).toBeInTheDocument();
    expect(await screen.findByText('Introduction to Computing')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a duplicate-class conflict from the server inside the form', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([]);
    vi.mocked(classesApi.createClass).mockRejectedValue(
      new ApiClientError({ status: 409, code: 'CONFLICT', message: 'You already have this subject and section for the same school year and semester' }),
    );
    renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: /New class/ }));
    const q = await fillClassForm();
    await userEvent.click(q.getByRole('button', { name: 'Create class' }));
    expect(await q.findByRole('alert')).toHaveTextContent('You already have this subject and section');
  });

  it('maps server field errors onto the form', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([]);
    vi.mocked(classesApi.createClass).mockRejectedValue(
      new ApiClientError({ status: 422, code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field: 'termEndDate', message: 'Term end date must be a valid date (YYYY-MM-DD)' }] }),
    );
    renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: /New class/ }));
    const q = await fillClassForm();
    await userEvent.click(q.getByRole('button', { name: 'Create class' }));
    expect(await q.findByText('Term end date must be a valid date (YYYY-MM-DD)')).toBeInTheDocument();
  });

  it('archives only after confirmation', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
    vi.mocked(classesApi.archiveClass).mockResolvedValue({ ...sampleClass, status: 'ARCHIVED' });
    renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: 'Archive IT 101 BSIT-1A' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this class?' });
    expect(dialog).toHaveTextContent('No attendance, scores, or grades are deleted');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(classesApi.archiveClass).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Archive IT 101 BSIT-1A' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive class' }));
    await waitFor(() => expect(classesApi.archiveClass).toHaveBeenCalledWith('c1'));
  });
});
