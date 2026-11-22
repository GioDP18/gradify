import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './renderApp';
import { fetchHealth } from '../services/healthApi';
import { restoreSession } from '../services/authApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/healthApi', () => ({ fetchHealth: vi.fn() }));
vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));

describe('System status page (public)', () => {
  beforeEach(() => {
    vi.mocked(fetchHealth).mockReset();
    vi.mocked(restoreSession).mockRejectedValue(new Error('no session'));
  });

  it('shows a connected database', async () => {
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', database: 'connected' });
    renderApp('/system-status');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('explains a degraded database', async () => {
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'degraded', database: 'disconnected' });
    renderApp('/system-status');
    expect(await screen.findByText('disconnected')).toBeInTheDocument();
    expect(screen.getByText(/cannot reach MongoDB/i)).toBeInTheDocument();
  });

  it('shows the API as unreachable and lets the user retry', async () => {
    vi.mocked(fetchHealth)
      .mockRejectedValueOnce(new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server.' }))
      .mockResolvedValueOnce({ status: 'ok', database: 'connected' });
    renderApp('/system-status');

    expect(await screen.findByText('Unreachable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('renders a 404 page for unknown routes', async () => {
    renderApp('/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
