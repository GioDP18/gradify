import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, student, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import { ApiClientError } from '../services/apiClient';
import { tokenStore } from '../services/tokenStore';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/dashboardApi', () => ({
  getOverview: vi.fn().mockResolvedValue(null),
  getAttendanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: {}, FINALS: {} }, trend: [] }),
  getPerformanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: {}, FINALS: {}, OVERALL: {} }, distribution: [], top: [], bottom: [], incomplete: [] }),
  getRecentActivity: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));

beforeEach(() => {
  vi.mocked(authApi.restoreSession).mockReset().mockRejectedValue(new Error('no session'));
  vi.mocked(authApi.login).mockReset();
  vi.mocked(authApi.logout).mockReset().mockResolvedValue();
  vi.mocked(classesApi.listClasses).mockReset().mockResolvedValue([sampleClass]);
});

describe('protected routes', () => {
  it('redirects signed-out users to the login page', async () => {
    renderApp('/classes');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('restores an existing session without showing the login page', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
    renderApp('/');
    expect(await screen.findByRole('heading', { name: /Maria/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument();
  });

  it('sends signed-in users away from /login', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('shows the access-restricted page to students', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(student);
    renderApp('/classes');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
    expect(screen.getByText(/Student features are not available yet/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });

  it('returns to the login page with a notice when the session expires in the background', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
    renderApp('/');
    await screen.findByRole('heading', { name: /Maria/ });
    tokenStore.notifySessionExpired();
    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });
});

describe('login page', () => {
  it('validates required fields before calling the API', async () => {
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email or username.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('toggles password visibility', async () => {
    renderApp('/login');
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('shows the server’s error message on failure', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiClientError({ status: 401, code: 'UNAUTHORIZED', message: 'Invalid email/username or password' }),
    );
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email or username'), 'maria@evsu.edu.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email/username or password');
  });

  it('"Forgot password?" explains that the administrator sets a new password', async () => {
    renderApp('/login');
    const link = await screen.findByRole('button', { name: 'Forgot password?' });
    expect(link).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Ask your Gradify administrator to set a new password/)).toBeInTheDocument();
  });

  it('signs in, passes "remember me", and returns to the page originally requested', async () => {
    vi.mocked(authApi.login).mockResolvedValue(instructor);
    const { router } = renderApp('/classes');
    await userEvent.type(await screen.findByLabelText('Email or username'), 'maria@evsu.edu.ph');
    await userEvent.type(screen.getByLabelText('Password'), 'Correct-Horse-9');
    await userEvent.click(screen.getByLabelText(/remember me/i));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/classes'));
    expect(authApi.login).toHaveBeenCalledWith({ identifier: 'maria@evsu.edu.ph', password: 'Correct-Horse-9', remember: true });
  });

  it('logs out from the account menu', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
    const { router } = renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: /Maria Santos/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /log out/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(authApi.logout).toHaveBeenCalled();
  });

  it('stays signed in and says so when logging out fails', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network'));
    const { router } = renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: /Maria Santos/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /log out/i }));
    expect(await screen.findByText(/Could not sign out/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: /Maria Santos/ })).toBeInTheDocument();
  });
});
