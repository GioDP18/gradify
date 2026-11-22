import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as studentsApi from '../services/studentsApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/studentsApi', () => ({
  listStudents: vi.fn(),
  getStudentFacets: vi.fn(),
  getStudent: vi.fn(),
  createStudent: vi.fn(),
  updateStudent: vi.fn(),
  archiveStudent: vi.fn(),
  restoreStudent: vi.fn(),
  exportStudents: vi.fn(),
  importStudents: vi.fn(),
  enrollStudents: vi.fn(),
  setEnrollmentStatus: vi.fn(),
  removeEnrollment: vi.fn(),
}));

vi.mock('../services/gradingApi', () => ({ getStudentGradesAcrossClasses: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/attendanceApi', () => ({ getAttendanceSummary: vi.fn().mockResolvedValue({ students: [], periods: [] }) }));

const juan = {
  id: 's1', studentNumber: '2026-00001', firstName: 'Juan', middleName: 'Protacio', lastName: 'Dela Cruz', fullName: 'Dela Cruz, Juan P.',
  email: null, course: 'BSIT', yearLevel: 1, section: 'A', enrollmentStatus: 'ENROLLED', archivedAt: null,
};
const maria = { ...juan, id: 's2', studentNumber: '2026-00002', firstName: 'Maria', middleName: null, lastName: 'Santos', fullName: 'Santos, Maria' };
const page = (items) => ({ items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
  vi.mocked(studentsApi.getStudentFacets).mockResolvedValue({ courses: ['BSIT'], sections: ['A'], yearLevels: [1] });
  vi.mocked(studentsApi.listStudents).mockResolvedValue(page([juan, maria]));
});

describe('students list', () => {
  it('lists students from the API', async () => {
    renderApp('/students');
    expect(await screen.findByRole('link', { name: 'Dela Cruz, Juan P.' })).toBeInTheDocument();
    expect(screen.getByText('Showing', { exact: false })).toHaveTextContent('Showing 1–2 of 2');
  });

  it('debounces search and sends filters and sorting to the API', async () => {
    renderApp('/students');
    await screen.findByRole('link', { name: 'Dela Cruz, Juan P.' });

    await userEvent.type(screen.getByLabelText('Search students'), 'santos');
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'santos', page: 1 })));

    await userEvent.selectOptions(screen.getByLabelText('Filter by course'), 'BSIT');
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenLastCalledWith(expect.objectContaining({ course: 'BSIT' })));

    await userEvent.click(screen.getByRole('button', { name: /Student No\./ }));
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'studentNumber', order: 'asc' })));
    await userEvent.click(screen.getByRole('button', { name: /Student No\./ }));
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'studentNumber', order: 'desc' })));
  });

  it('shows the class roster with DRP status when scoped to the working class', async () => {
    vi.mocked(studentsApi.listStudents).mockImplementation(async (params) =>
      params.classId ? page([{ ...juan, enrollment: { status: 'DROPPED' } }]) : page([juan, maria]),
    );
    renderApp('/students');
    await userEvent.click(await screen.findByRole('button', { name: 'In IT 101 · BSIT-1A' }));
    await waitFor(() => expect(studentsApi.listStudents).toHaveBeenLastCalledWith(expect.objectContaining({ classId: 'c1' })));
    expect(await screen.findByText('DRP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reinstate Dela Cruz, Juan P. in class' })).toBeInTheDocument();
  });

  it('bulk-enrolls selected students in the working class', async () => {
    vi.mocked(studentsApi.enrollStudents).mockResolvedValue({ enrolled: 2, reinstated: 0, alreadyEnrolled: 0 });
    renderApp('/students');
    await userEvent.click(await screen.findByLabelText('Select Dela Cruz, Juan P.'));
    await userEvent.click(screen.getByLabelText('Select Santos, Maria'));
    await userEvent.click(screen.getByRole('button', { name: 'Enroll in IT 101 · BSIT-1A' }));
    await waitFor(() => expect(studentsApi.enrollStudents).toHaveBeenCalledWith('c1', ['s1', 's2']));
    expect(await screen.findByText('IT 101 · BSIT-1A: 2 enrolled.')).toBeInTheDocument();
  });

  it('archives a student only after confirmation', async () => {
    vi.mocked(studentsApi.archiveStudent).mockResolvedValue({ ...juan, archivedAt: '2026-11-22' });
    renderApp('/students');
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Dela Cruz, Juan P.' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this student?' });
    expect(dialog).toHaveTextContent('attendance, scores, and grades are kept');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive student' }));
    await waitFor(() => expect(studentsApi.archiveStudent).toHaveBeenCalledWith('s1'));
  });
});

describe('add student form', () => {
  it('validates fields client-side', async () => {
    renderApp('/students');
    await userEvent.click(await screen.findByRole('button', { name: 'Add student' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add student' });
    await userEvent.type(within(dialog).getByLabelText(/Student number/), '#1');
    await userEvent.type(within(dialog).getByLabelText(/First name/), 'J0hn');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add student' }));

    expect(await within(dialog).findByText('3–20 letters, numbers, or dashes.')).toBeInTheDocument();
    expect(within(dialog).getByText('Letters, spaces, apostrophes, dots, and dashes only.')).toBeInTheDocument();
    expect(within(dialog).getByText('Last name is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Select a year level.')).toBeInTheDocument();
    expect(studentsApi.createStudent).not.toHaveBeenCalled();
  });

  it('creates and enrolls in the working class, and shows server conflicts', async () => {
    vi.mocked(studentsApi.createStudent)
      .mockRejectedValueOnce(new ApiClientError({ status: 409, code: 'CONFLICT', message: 'Student number 2026-00009 already exists in your roster' }))
      .mockResolvedValueOnce({ ...juan, id: 's9', fullName: 'Reyes, Ana' });
    renderApp('/students');
    await userEvent.click(await screen.findByRole('button', { name: 'Add student' }));
    const q = within(await screen.findByRole('dialog', { name: 'Add student' }));
    await userEvent.type(q.getByLabelText(/Student number/), '2026-00009');
    await userEvent.type(q.getByLabelText(/Last name/), 'Reyes');
    await userEvent.type(q.getByLabelText(/First name/), 'Ana');
    await userEvent.type(q.getByLabelText(/Course/), 'BSIT');
    await userEvent.selectOptions(q.getByLabelText(/Year level/), '1');
    await userEvent.type(q.getByLabelText(/Section/), 'A');
    expect(q.getByLabelText(/Also enroll in my working class/)).toBeChecked();

    await userEvent.click(q.getByRole('button', { name: 'Add student' }));
    expect(await q.findByRole('alert')).toHaveTextContent('already exists in your roster');

    await userEvent.click(q.getByRole('button', { name: 'Add student' }));
    await waitFor(() => expect(studentsApi.createStudent).toHaveBeenCalledTimes(2));
    expect(vi.mocked(studentsApi.createStudent).mock.calls[1]).toEqual([
      expect.objectContaining({ studentNumber: '2026-00009', lastName: 'Reyes', yearLevel: 1 }),
      { classId: 'c1' },
    ]);
    expect(await screen.findByText('Reyes, Ana added and enrolled in IT 101 · BSIT-1A.')).toBeInTheDocument();
  });
});

describe('CSV import', () => {
  it('checks the file first, shows row errors, then imports valid rows on confirmation', async () => {
    vi.mocked(studentsApi.importStudents)
      .mockResolvedValueOnce({ dryRun: true, totalRows: 3, toCreate: 2, toEnrollExisting: 0, invalidRows: 1, warnings: [],
        errors: [{ row: 4, studentNumber: 'X-1', errors: [{ field: 'yearLevel', message: 'Year level must be a whole number from 1 to 6' }] }] })
      .mockResolvedValueOnce({ created: 2, enrolledExisting: 0, skipped: 1 });
    renderApp('/students');
    await userEvent.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import students from CSV' });
    const q = within(dialog);

    expect(q.getByRole('button', { name: 'Check file' })).toBeDisabled();
    const file = new File(['Student Number,...'], 'class-list.csv', { type: 'text/csv' });
    await userEvent.upload(q.getByLabelText(/CSV file/), file);
    await userEvent.click(q.getByRole('button', { name: 'Check file' }));

    expect(await q.findByText('Year level must be a whole number from 1 to 6')).toBeInTheDocument();
    expect(q.getByText('4')).toBeInTheDocument();
    expect(vi.mocked(studentsApi.importStudents).mock.calls[0][1]).toEqual({ classId: 'c1', dryRun: true });

    await userEvent.click(q.getByRole('button', { name: 'Import 2 valid rows, skip 1' }));
    await waitFor(() => expect(vi.mocked(studentsApi.importStudents).mock.calls[1][1]).toEqual({ classId: 'c1', skipInvalid: true }));
    expect(await screen.findByText('Import complete: 2 added, 1 skipped.')).toBeInTheDocument();
  });
});

describe('student detail', () => {
  it('shows student information and class enrollments, and drops with a reason', async () => {
    vi.mocked(studentsApi.getStudent).mockResolvedValue({
      ...juan,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
      enrollments: [{ classId: 'c1', subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST', classStatus: 'ACTIVE', status: 'ENROLLED', enrolledAt: '2026-11-01T00:00:00Z' }],
    });
    vi.mocked(studentsApi.setEnrollmentStatus).mockResolvedValue({ status: 'DROPPED' });
    renderApp('/students/s1');

    expect(await screen.findByRole('heading', { name: 'Dela Cruz, Juan P.' })).toBeInTheDocument();
    expect(screen.getByText('Protacio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Drop/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Drop student from class?' });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Officially dropped');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Drop student' }));
    await waitFor(() => expect(studentsApi.setEnrollmentStatus).toHaveBeenCalledWith('c1', 's1', { status: 'DROPPED', reason: 'Officially dropped' }));
  });

  it('shows a not-found state', async () => {
    vi.mocked(studentsApi.getStudent).mockRejectedValue(new ApiClientError({ status: 404, code: 'NOT_FOUND', message: 'Student not found' }));
    renderApp('/students/missing');
    expect(await screen.findByRole('heading', { name: 'Student not found' })).toBeInTheDocument();
  });
});
