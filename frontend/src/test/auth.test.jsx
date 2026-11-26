import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

  it('"Forgot password?" opens the reset page, and "Contact support" explains the options when the chat is off', async () => {
    vi.stubEnv('VITE_SUPPORT_CHAT_URL', '');
    renderApp('/login');
    const help = await screen.findByRole('button', { name: 'Contact support' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/ask your Gradify administrator to set a new password/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('link', { name: 'Forgot password?' })[0]);
    expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chat with Gradify support' })).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('"Contact support" opens the chat box, which loads the assistant only then and stays across the sign-in pages', async () => {
    vi.stubEnv('VITE_SUPPORT_CHAT_URL', 'https://www.noupe.com/agent/abc123');
    try {
      renderApp('/login');
      const contact = await screen.findByRole('button', { name: 'Contact support' });
      expect(document.querySelector('iframe')).toBeNull();

      await userEvent.click(contact);
      const chat = screen.getByRole('dialog', { name: 'Gradify support chat' });
      const frame = within(chat).getByTitle('Gradify support assistant');
      expect(frame.getAttribute('src').startsWith('https://www.noupe.com/agent/abc123?')).toBe(true);
      expect(frame).toHaveAttribute('sandbox');

      // moving to "Forgot password?" keeps the same chat open
      await userEvent.click(screen.getAllByRole('link', { name: 'Forgot password?' })[0]);
      expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
      expect(within(screen.getByRole('dialog', { name: 'Gradify support chat' })).getByTitle('Gradify support assistant')).toBe(frame);

      // closing hides it but keeps the conversation; the corner button opens it again
      await userEvent.click(screen.getByRole('button', { name: 'Close chat' }));
      expect(screen.queryByRole('dialog', { name: 'Gradify support chat' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Chat with Gradify support' }));
      expect(within(screen.getByRole('dialog', { name: 'Gradify support chat' })).getByTitle('Gradify support assistant')).toBe(frame);
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Gradify support chat' })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('ignores a support chat address that is not a Noupe assistant', async () => {
    vi.stubEnv('VITE_SUPPORT_CHAT_URL', 'https://example.com/agent/abc123');
    try {
      renderApp('/login');
      await userEvent.click(await screen.findByRole('button', { name: 'Contact support' }));
      expect(screen.getByText(/ask your Gradify administrator to set a new password/)).toBeInTheDocument();
      expect(document.querySelector('iframe')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
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
