import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as studentsApi from '../services/studentsApi';
import * as assessmentsApi from '../services/assessmentsApi';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/studentsApi', () => ({
  listStudents: vi.fn(),
  getStudentFacets: vi.fn().mockResolvedValue({ courses: [], sections: [], yearLevels: [] }),
}));
vi.mock('../services/assessmentsApi', () => ({ listAssessments: vi.fn() }));

const page = { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(studentsApi.listStudents).mockResolvedValue(page);
  vi.mocked(assessmentsApi.listAssessments).mockResolvedValue([]); // assessment lists are plain arrays
});

describe('refresh buttons', () => {
  it('reloads the student list (and classes) from the server', async () => {
    renderApp('/students?scope=class');
    const button = await screen.findByRole('button', { name: 'Refresh students' });
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenCalled());
    const before = vi.mocked(studentsApi.listStudents).mock.calls.length;
    await userEvent.click(button);
    await waitFor(() => expect(vi.mocked(studentsApi.listStudents).mock.calls.length).toBeGreaterThan(before));
  });

  it('reloads classes and an assessment list', async () => {
    const { router } = renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh classes' }));
    await waitFor(() => expect(vi.mocked(classesApi.listClasses).mock.calls.length).toBeGreaterThan(1));

    await router.navigate('/quizzes');
    const quizzes = await screen.findByRole('button', { name: 'Refresh written quizzes' });
    await waitFor(() => expect(assessmentsApi.listAssessments).toHaveBeenCalled());
    const before = vi.mocked(assessmentsApi.listAssessments).mock.calls.length;
    await userEvent.click(quizzes);
    await waitFor(() => expect(vi.mocked(assessmentsApi.listAssessments).mock.calls.length).toBeGreaterThan(before));
  });
});
