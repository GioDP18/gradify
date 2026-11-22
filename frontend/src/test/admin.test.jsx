import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { renderApp, instructor } from './renderApp';
import * as authApi from '../services/authApi';
import * as adminApi from '../services/adminApi';
import * as classesApi from '../services/classesApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/adminApi', () => ({ listAccounts: vi.fn(), createInstructor: vi.fn(), setAccountStatus: vi.fn(), setAccountPassword: vi.fn() }));

const admin = { id: 'a1', name: 'Registrar Admin', email: 'admin@evsu.edu.ph', role: 'ADMIN', status: 'ACTIVE' };
const maria = { id: 'u7', name: 'Maria Santos', email: 'maria@evsu.edu.ph', username: 'msantos', role: 'INSTRUCTOR', status: 'ACTIVE', lastLoginAt: null, activeClasses: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(admin);
  vi.mocked(adminApi.listAccounts).mockResolvedValue([admin, maria]);
});

describe('administrator', () => {
  it('starts at instructor accounts, with an admin-only sidebar and no class data', async () => {
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/users'));
    expect(await screen.findByRole('heading', { name: 'Instructor accounts', level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('link', { name: 'Grading criteria' })).toHaveAttribute('href', '/settings/grading');
    expect(within(nav).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Attendance' })).not.toBeInTheDocument();
    expect(classesApi.listClasses).not.toHaveBeenCalled();
    expect(screen.getByText('Administrator')).toBeInTheDocument(); // header role
  });

  it('lists instructors and creates an account, then shows the sign-in details once', async () => {
    vi.mocked(adminApi.createInstructor).mockResolvedValue({ ...maria, id: 'u8', name: 'Jose Rizal', email: 'jose@evsu.edu.ph', username: null, activeClasses: 0 });
    renderApp('/settings/users');
    const row = (await screen.findByText('Maria Santos')).closest('tr');
    expect(within(row).getByText('msantos')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /Add instructor/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add instructor' });
    const password = within(dialog).getByLabelText(/Temporary password/);
    expect(password.value).toMatch(/^.{16}$/); // a strong password is generated for you
    await userEvent.type(within(dialog).getByLabelText(/Full name/), 'Jose Rizal');
    await userEvent.type(within(dialog).getByLabelText(/Email/), 'jose@evsu.edu.ph');
    const generated = password.value;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(adminApi.createInstructor).toHaveBeenCalledWith({ name: 'Jose Rizal', email: 'jose@evsu.edu.ph', username: undefined, password: generated }));
    const done = await screen.findByRole('dialog', { name: 'Instructor account created' });
    expect(within(done).getByText(generated)).toBeInTheDocument();
    expect(within(done).getByRole('button', { name: /Copy sign-in details/ })).toBeInTheDocument();
  });

  it('shows server field errors when creating an account', async () => {
    vi.mocked(adminApi.createInstructor).mockRejectedValue(new ApiClientError({ status: 422, code: 'VALIDATION_ERROR', message: 'invalid', details: [{ field: 'email', message: 'Another account already uses this email.' }] }));
    renderApp('/settings/users');
    await userEvent.click((await screen.findAllByRole('button', { name: /Add instructor/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add instructor' });
    await userEvent.type(within(dialog).getByLabelText(/Full name/), 'Maria Again');
    await userEvent.type(within(dialog).getByLabelText(/Email/), 'maria@evsu.edu.ph');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByText('Another account already uses this email.')).toBeInTheDocument();
  });

  it('disables an instructor after confirming, and sets a new password', async () => {
    vi.mocked(adminApi.setAccountStatus).mockResolvedValue({ ...maria, status: 'DISABLED' });
    vi.mocked(adminApi.setAccountPassword).mockResolvedValue(maria);
    renderApp('/settings/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Disable Maria Santos' }));
    const confirm = await screen.findByRole('dialog', { name: 'Disable Maria Santos?' });
    expect(confirm).toHaveTextContent('classes, students, and grades are kept');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Disable account' }));
    await waitFor(() => expect(adminApi.setAccountStatus).toHaveBeenCalledWith('u7', 'DISABLED'));
    expect(await screen.findByText('Maria Santos can no longer sign in.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Set a new password for Maria Santos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set a new password for Maria Santos' });
    const value = within(dialog).getByLabelText(/Temporary password/).value;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(adminApi.setAccountPassword).toHaveBeenCalledWith('u7', value));
    expect(await screen.findByRole('dialog', { name: 'New password set' })).toHaveTextContent(value);
  });
});

describe('accessibility', () => {
  it('instructor accounts and the add-instructor dialog have no axe violations', async () => {
    const { container } = renderApp('/settings/users');
    await screen.findByText('Maria Santos');
    const check = async (node) => {
      const results = await axe.run(node, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    };
    await check(container);
    await userEvent.click(screen.getAllByRole('button', { name: /Add instructor/ })[0]);
    await check(await screen.findByRole('dialog', { name: 'Add instructor' }));
  });
});

describe('instructors and settings', () => {
  beforeEach(() => vi.mocked(authApi.restoreSession).mockResolvedValue(instructor));

  it('cannot open instructor accounts', async () => {
    renderApp('/settings/users');
    expect(await screen.findByText(/access/i)).toBeInTheDocument();
    expect(adminApi.listAccounts).not.toHaveBeenCalled();
  });

  it('see every setting on /settings; each section opens on its own page (old /profile still works)', async () => {
    const { router } = renderApp('/settings');
    expect(await screen.findByRole('switch', { name: 'Use a working class' })).toBeInTheDocument();
    const more = screen.getByRole('region', { name: 'More settings' });
    expect(within(more).getByRole('link', { name: /Grading criteria/ })).toHaveAttribute('href', '/settings/grading');
    await userEvent.click(within(more).getByRole('link', { name: /My profile/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument(); // no tab bar

    await router.navigate('/profile');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));
  });

  it('the administrator sees accounts, criteria, and profile on /settings (no class setting)', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(admin);
    renderApp('/settings');
    const list = await screen.findByRole('region', { name: 'Settings' });
    expect(within(list).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/settings/users', '/settings/grading', '/settings/profile']);
    expect(screen.queryByRole('switch', { name: 'Use a working class' })).not.toBeInTheDocument();
  });
});
