import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './renderApp';
import * as authApi from '../services/authApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({
  restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn(),
  requestPasswordReset: vi.fn(), checkResetToken: vi.fn(), resetPassword: vi.fn(),
}));

const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF1234';
const STRONG = 'Brand-New-Passw0rd!';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockRejectedValue(new Error('signed out'));
});

describe('forgot password: asking for a link', () => {
  it('sends the request and then says the same thing for any address', async () => {
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({ message: 'ok' });
    renderApp('/forgot-password');
    const email = await screen.findByLabelText('Email address', {}, { timeout: 4000 });
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter the email address of your account.')).toBeInTheDocument();
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();

    await userEvent.type(email, ' maria@evsu.edu.ph ');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(authApi.requestPasswordReset).toHaveBeenCalledWith('maria@evsu.edu.ph'));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Check your email');
    expect(status).toHaveTextContent('If an account uses maria@evsu.edu.ph');
    expect(status).toHaveTextContent('works once and only for 30 minutes');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows the server message when the request is refused', async () => {
    vi.mocked(authApi.requestPasswordReset).mockRejectedValue(new ApiClientError({ status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many reset requests. Please wait 15 minutes and try again.' }));
    renderApp('/forgot-password');
    await userEvent.type(await screen.findByLabelText('Email address', {}, { timeout: 4000 }), 'maria@evsu.edu.ph');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests');
  });
});

describe('forgot password: choosing a new password', () => {
  it('takes the token out of the address, enforces the rules, and changes the password', async () => {
    vi.mocked(authApi.checkResetToken).mockResolvedValue(true);
    vi.mocked(authApi.resetPassword).mockResolvedValue({ message: 'ok' });
    const { router } = renderApp(`/reset-password/${TOKEN}`);
    const password = await screen.findByLabelText('New password', {}, { timeout: 4000 });
    expect(authApi.checkResetToken).toHaveBeenCalledWith(TOKEN);
    expect(router.state.location.pathname).toBe('/reset-password'); // no token left in the address

    await userEvent.type(password, 'weak');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'weak');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The new password does not meet all the requirements below.')).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();

    await userEvent.clear(password);
    await userEvent.type(password, STRONG);
    expect(screen.getByText('At least 12 characters').closest('li')).toHaveClass('is-met');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('Confirm new password'), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith(TOKEN, STRONG));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('explains a link that is used, expired, or missing, and offers a new one', async () => {
    vi.mocked(authApi.checkResetToken).mockResolvedValue(false);
    renderApp(`/reset-password/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('shows the server message for a rejected password, and a dead link found on submit', async () => {
    vi.mocked(authApi.checkResetToken).mockResolvedValue(true);
    vi.mocked(authApi.resetPassword)
      .mockRejectedValueOnce(new ApiClientError({ status: 422, code: 'VALIDATION_ERROR', message: 'invalid', details: [{ field: 'newPassword', message: 'Choose a password different from your current one.' }] }))
      .mockRejectedValueOnce(new ApiClientError({ status: 400, code: 'RESET_LINK_INVALID', message: 'This reset link is not valid or has expired. Request a new one.' }));
    renderApp(`/reset-password/${TOKEN}`);
    await userEvent.type(await screen.findByLabelText('New password', {}, { timeout: 4000 }), STRONG);
    await userEvent.type(screen.getByLabelText('Confirm new password'), STRONG);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Choose a password different from your current one.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();
  });
});
