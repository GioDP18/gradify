import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/dashboardApi', () => ({
  getOverview: vi.fn().mockResolvedValue(null),
  getAttendanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: {}, FINALS: {} }, trend: [] }),
  getPerformanceDashboard: vi.fn().mockResolvedValue({ periods: { MIDTERM: {}, FINALS: {}, OVERALL: {} }, distribution: [], top: [], bottom: [], incomplete: [] }),
  getRecentActivity: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/attendanceApi', () => ({
  listSessions: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 25, total: 0, totalPages: 1 } }),
  getAttendanceSummary: vi.fn().mockResolvedValue({ periods: [], students: [] }),
}));

beforeEach(() => {
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([
    sampleClass,
    { ...sampleClass, id: 'c2', subjectCode: 'IT 102', section: 'BSIT-1B' },
  ]);
});

describe('app layout', () => {
  it('opens the navigation drawer on small screens and closes it with Escape or navigation', async () => {
    renderApp('/');
    const toggle = await screen.findByRole('button', { name: 'Open navigation' });
    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar).toHaveClass('is-open');

    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    await userEvent.click(within(sidebar).getByRole('link', { name: 'Classes' }));
    await waitFor(() => expect(sidebar).not.toHaveClass('is-open'));
  });

  it('marks the current page and links every module', async () => {
    renderApp('/classes');
    const sidebar = await screen.findByRole('complementary', { name: 'Main navigation' });
    expect(within(sidebar).getByRole('link', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Dashboard', 'Students', 'Attendance', 'Written Quizzes', 'Performance Activities', 'Examinations', 'Grading']) {
      expect(within(sidebar).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(sidebar.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  it('shows the page title and breadcrumbs', async () => {
    renderApp('/classes');
    expect(await screen.findByRole('heading', { level: 1, name: 'Classes' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(crumbs).getByText('Classes')).toHaveAttribute('aria-current', 'page');
  });

  it('switches the working class from the top bar', async () => {
    renderApp('/');
    const switcher = await screen.findByLabelText('Active class');
    // The dashboard opens on "All classes".
    await waitFor(() => expect(switcher).toHaveValue('ALL'));
    await userEvent.selectOptions(switcher, 'c2');
    expect(await screen.findByRole('heading', { name: /IT 102 · BSIT-1B/ })).toBeInTheDocument();
  });

  it('shows the class filter only on the dashboard; class pages say which class they work in', async () => {
    const { router } = renderApp('/attendance');
    const note = await screen.findByRole('note', { name: 'Working class' });
    expect(note).toHaveTextContent('Working in');
    expect(note).toHaveTextContent('IT 101 · BSIT-1A');
    expect(within(note).getByRole('link', { name: 'Switch class' })).toHaveAttribute('href', '/classes');
    expect(screen.queryByLabelText('Active class')).not.toBeInTheDocument();

    await router.navigate('/classes');
    await screen.findByRole('heading', { name: 'Classes', level: 1 });
    expect(screen.queryByLabelText('Active class')).not.toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'Working class' })).not.toBeInTheDocument();

    await router.navigate('/');
    expect(await screen.findByLabelText('Active class')).toBeInTheDocument();
  });
});
