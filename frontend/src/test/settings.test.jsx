import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as attendanceApi from '../services/attendanceApi';
import * as assessmentsApi from '../services/assessmentsApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn(), updatePreferences: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/attendanceApi', () => ({
  listSessions: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }),
  getAttendanceSummary: vi.fn().mockResolvedValue({ periods: [], students: [] }),
}));
vi.mock('../services/assessmentsApi', () => ({
  listAssessments: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }),
}));

const second = { ...sampleClass, id: 'c2', subjectCode: 'IT 102', section: 'BSIT-1B' };
const withPref = (workingClass) => ({ ...instructor, preferences: { workingClass } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass, second]);
});

describe('settings page', () => {
  it('is in the sidebar and turns the working class off', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(withPref(true));
    vi.mocked(authApi.updatePreferences).mockResolvedValue(withPref(false));
    const { router } = renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));

    const toggle = await screen.findByRole('switch', { name: 'Use a working class' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(authApi.updatePreferences).toHaveBeenCalledWith({ workingClass: false }));
    expect(toggle).not.toBeChecked();
    expect(await screen.findByText(/Each page now has its own class selector/)).toBeInTheDocument();
  });

  it('turns the assistant\'s chat history off (the saved chats are kept)', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(withPref(true));
    vi.mocked(authApi.updatePreferences).mockResolvedValue({ ...withPref(true), preferences: { workingClass: true, chatHistory: false } });
    renderApp('/settings');

    const toggle = await screen.findByRole('switch', { name: 'Keep chat history' });
    expect(toggle).toBeChecked(); // on unless turned off
    expect(screen.getByText(/saved to your account, so the history is there on any device/)).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(authApi.updatePreferences).toHaveBeenCalledWith({ chatHistory: false }));
    expect(toggle).not.toBeChecked();
    expect(await screen.findByText(/Your saved chats are kept/)).toBeInTheDocument();
    expect(screen.getByText(/Off: new conversations are not saved/)).toBeInTheDocument();
  });

  it('puts the switch back when saving fails', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(withPref(true));
    vi.mocked(authApi.updatePreferences).mockRejectedValue(new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server.' }));
    renderApp('/settings');
    const toggle = await screen.findByRole('switch', { name: 'Use a working class' });
    await userEvent.click(toggle);
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument();
    expect(toggle).toBeChecked();
  });
});

describe('working class off: each page picks its own class', () => {
  beforeEach(() => vi.mocked(authApi.restoreSession).mockResolvedValue(withPref(false)));

  it('gives Attendance its own class selector without changing other pages', async () => {
    const { router } = renderApp('/attendance');
    const select = await screen.findByLabelText('Class');
    expect(select).toHaveValue('c1');
    expect(screen.queryByRole('note', { name: 'Working class' })).not.toBeInTheDocument();

    await userEvent.selectOptions(select, 'c2');
    await waitFor(() => expect(attendanceApi.listSessions).toHaveBeenLastCalledWith(expect.objectContaining({ classId: 'c2' })));

    // Written Quizzes still shows its own (unchanged) class.
    await router.navigate('/quizzes');
    await waitFor(() => expect(screen.getByLabelText('Class')).toHaveValue('c1'));
    await waitFor(() => expect(assessmentsApi.listAssessments).toHaveBeenLastCalledWith('/quizzes', expect.objectContaining({ classId: 'c1' })));

    // Back on Attendance, its choice was remembered.
    await router.navigate('/attendance');
    await waitFor(() => expect(screen.getByLabelText('Class')).toHaveValue('c2'));
  });

  it('removes "Work in this class" from the Classes page', async () => {
    renderApp('/classes');
    await screen.findByText('IT 102');
    expect(screen.queryByRole('button', { name: /Work in this class/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Working class')).not.toBeInTheDocument();
  });
});

describe('working class on (default)', () => {
  it('keeps "Work in this class" and the read-only working-class line', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor); // no preferences yet → on
    renderApp('/classes');
    expect(await screen.findByRole('button', { name: /Work in this class/ })).toBeInTheDocument();
    expect(screen.getByText('Working class')).toBeInTheDocument();
  });
});
