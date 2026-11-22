import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as assessmentsApi from '../services/assessmentsApi';
import { ApiClientError } from '../services/apiClient';
import { parseScoreInput } from '../pages/assessments/AssessmentScoresPage';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/assessmentsApi', () => ({
  listAssessments: vi.fn(),
  createAssessment: vi.fn(),
  updateAssessment: vi.fn(),
  deleteAssessment: vi.fn(),
  getScoreSheet: vi.fn(),
  saveScores: vi.fn(),
}));

const stats = { totalStudents: 3, scoredCount: 1, missingCount: 2, highest: 18, lowest: 18, average: 18, averagePercent: 90, distribution: [] };
const quiz = { id: 'q1', classId: 'c1', title: 'Quiz 1', period: 'MIDTERM', date: '2026-09-10', maxScore: 20, status: 'PUBLISHED', revision: 0, description: null, instructions: null, stats };
const rows = [
  { studentId: 's1', studentNumber: '2026-001', fullName: 'Bautista, Ana', score: 18, itemPercent: 90, required: true, enrollmentStatus: 'ENROLLED', archived: false },
  { studentId: 's2', studentNumber: '2026-002', fullName: 'Cruz, Ben', score: null, itemPercent: null, required: true, enrollmentStatus: 'ENROLLED', archived: false },
  { studentId: 's3', studentNumber: '2026-003', fullName: 'Dizon, Carla', score: null, itemPercent: null, required: true, enrollmentStatus: 'ENROLLED', archived: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(assessmentsApi.listAssessments).mockResolvedValue([quiz]);
  vi.mocked(assessmentsApi.getScoreSheet).mockResolvedValue({ assessment: quiz, rows });
});

describe('parseScoreInput', () => {
  it('distinguishes blank (no score) from zero and validates range/precision', () => {
    expect(parseScoreInput('', 20)).toEqual({ value: null });
    expect(parseScoreInput('  ', 20)).toEqual({ value: null });
    expect(parseScoreInput('0', 20)).toEqual({ value: 0 });
    expect(parseScoreInput('17.5', 20)).toEqual({ value: 17.5 });
    expect(parseScoreInput('20', 20)).toEqual({ value: 20 });
    expect(parseScoreInput('21', 20).error).toMatch(/Cannot exceed 20/);
    expect(parseScoreInput('-1', 20).error).toBeDefined();
    expect(parseScoreInput('1.234', 20).error).toBeDefined();
    expect(parseScoreInput('abc', 20).error).toBeDefined();
  });
});

describe.each([
  ['quizzes', '/quizzes', 'Written Quizzes', 'quiz', '/quizzes'],
  ['activities', '/activities', 'Performance Activities', 'activity', '/activities'],
  ['examinations', '/examinations', 'Examinations', 'examination', '/examinations'],
])('%s list page', (_key, path, title, singular, api) => {
  it(`lists ${title} for the working class and period`, async () => {
    renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Quiz 1' })).toBeInTheDocument();
    expect(assessmentsApi.listAssessments).toHaveBeenCalledWith(api, expect.objectContaining({ classId: 'c1', period: 'MIDTERM' }));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`New ${singular}`) })).toBeInTheDocument();
  });
});

describe('creating and deleting', () => {
  it('validates and creates a quiz, then opens score entry', async () => {
    vi.mocked(assessmentsApi.createAssessment).mockResolvedValue({ ...quiz, id: 'q9' });
    const { router } = renderApp('/quizzes');
    await userEvent.click(await screen.findByRole('button', { name: /New quiz/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New quiz' });
    const q = within(dialog);

    await userEvent.type(q.getByLabelText(/Total possible score/), '0');
    await userEvent.click(q.getByRole('button', { name: 'Create quiz' }));
    expect(await q.findByText('Title is required.')).toBeInTheDocument();
    expect(q.getByText('Must be greater than zero.')).toBeInTheDocument();
    expect(assessmentsApi.createAssessment).not.toHaveBeenCalled();

    await userEvent.type(q.getByLabelText(/Title/), 'Quiz 2');
    await userEvent.clear(q.getByLabelText(/Total possible score/));
    await userEvent.type(q.getByLabelText(/Total possible score/), '25.5');
    await userEvent.click(q.getByRole('button', { name: 'Create quiz' }));
    await waitFor(() => expect(assessmentsApi.createAssessment).toHaveBeenCalledWith('/quizzes', expect.objectContaining({
      classId: 'c1', title: 'Quiz 2', period: 'MIDTERM', maxScore: 25.5, status: 'PUBLISHED',
    })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/quizzes/q9'));
  });

  it('deletes after a confirmation that explains scores are kept', async () => {
    vi.mocked(assessmentsApi.deleteAssessment).mockResolvedValue();
    renderApp('/examinations');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Quiz 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this examination?' });
    expect(dialog).toHaveTextContent('1 recorded score are kept');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete examination' }));
    await waitFor(() => expect(assessmentsApi.deleteAssessment).toHaveBeenCalledWith('/examinations', 'q1'));
  });
});

describe('score entry', () => {
  it('shows statistics, saved scores, and blank cells for missing scores', async () => {
    renderApp('/quizzes/q1');
    expect(await screen.findByRole('heading', { name: 'Quiz 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Score for Bautista, Ana')).toHaveValue('18');
    expect(screen.getByLabelText('Score for Cruz, Ben')).toHaveValue('');
    expect(screen.getAllByText('No score').length).toBeGreaterThan(0);
    expect(screen.getByText('Without scores').nextSibling).toHaveTextContent('2');
    expect(screen.getAllByText('90%')).toHaveLength(2); // class average + Ana's row
  });

  it('saves only changed cells: numbers, a real zero, and a cleared score (null)', async () => {
    vi.mocked(assessmentsApi.saveScores).mockResolvedValue({ changed: 3, revision: 1, assessment: { ...quiz, revision: 1 }, rows });
    renderApp('/quizzes/q1');
    const ana = await screen.findByLabelText('Score for Bautista, Ana');
    const ben = screen.getByLabelText('Score for Cruz, Ben');
    const carla = screen.getByLabelText('Score for Dizon, Carla');

    await userEvent.clear(ana); // clear = no score
    await userEvent.type(ben, '0');
    await userEvent.type(carla, '19.5');
    expect(screen.getByText('3 unsaved changes')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Save scores/ }));
    await waitFor(() => expect(assessmentsApi.saveScores).toHaveBeenCalledWith('/quizzes', 'q1', {
      revision: 0,
      scores: [{ studentId: 's1', score: null }, { studentId: 's2', score: 0 }, { studentId: 's3', score: 19.5 }],
    }));
    expect(await screen.findByText('Scores saved (3 changes).')).toBeInTheDocument();
  });

  it('blocks saving while a score is invalid and explains why', async () => {
    renderApp('/quizzes/q1');
    const ben = await screen.findByLabelText('Score for Cruz, Ben');
    await userEvent.type(ben, '25');
    expect(screen.getByText('Cannot exceed 20.')).toBeInTheDocument();
    expect(ben).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('1 score need fixing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save scores/ })).toBeDisabled();
  });

  it('typing back the saved value is not a change', async () => {
    renderApp('/quizzes/q1');
    const ana = await screen.findByLabelText('Score for Bautista, Ana');
    await userEvent.clear(ana);
    await userEvent.type(ana, '18');
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('moves to the next student with Enter', async () => {
    renderApp('/quizzes/q1');
    const ana = await screen.findByLabelText('Score for Bautista, Ana');
    ana.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Score for Cruz, Ben')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(ana).toHaveFocus();
  });

  it('filters to students without a score', async () => {
    renderApp('/quizzes/q1');
    await userEvent.click(await screen.findByLabelText(/Only students without a score/));
    expect(screen.queryByLabelText('Score for Bautista, Ana')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Score for Cruz, Ben')).toBeInTheDocument();
  });

  it('handles a stale save by offering to reload', async () => {
    vi.mocked(assessmentsApi.saveScores).mockRejectedValue(new ApiClientError({ status: 409, code: 'STALE_REVISION', message: 'These scores were changed elsewhere (another tab or device). Reload to see the latest before saving.' }));
    renderApp('/quizzes/q1');
    await userEvent.type(await screen.findByLabelText('Score for Cruz, Ben'), '10');
    await userEvent.click(screen.getByRole('button', { name: /Save scores/ }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reload latest/ }));
    await waitFor(() => expect(assessmentsApi.getScoreSheet).toHaveBeenCalledTimes(2));
  });

  it('warns about draft items not counting toward grades', async () => {
    vi.mocked(assessmentsApi.getScoreSheet).mockResolvedValue({ assessment: { ...quiz, status: 'DRAFT' }, rows });
    renderApp('/activities/q1');
    expect(await screen.findByText('Draft — not counted toward grades')).toBeInTheDocument();
  });
});
