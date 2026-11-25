import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import * as publicApi from '../services/publicApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn(), setSelfEnrollment: vi.fn(), newSelfEnrollmentLink: vi.fn() }));
vi.mock('../services/publicApi', () => ({ getJoinInfo: vi.fn(), selfEnroll: vi.fn() }));
vi.mock('../services/studentsApi', () => ({
  listStudents: vi.fn().mockResolvedValue({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }),
  getStudentFacets: vi.fn().mockResolvedValue({ courses: [], sections: [], yearLevels: [] }),
}));
// Drawing a QR code needs a real canvas; the image itself is not under test.
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';
const closedNoLink = { ...sampleClass, selfEnrollment: { open: false, token: null } };
const openWithLink = { ...sampleClass, selfEnrollment: { open: true, token: TOKEN } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(instructor);
});

describe('instructor: QR enrollment for a class', () => {
  it('is off by default; turning it on shows the QR code and the join link', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValueOnce([closedNoLink]).mockResolvedValue([openWithLink]);
    vi.mocked(classesApi.setSelfEnrollment).mockResolvedValue(openWithLink);
    renderApp('/students?scope=class'); // the QR code button on the class's student list
    await userEvent.click(await screen.findByRole('button', { name: /QR code/ }));
    const dialog = await screen.findByRole('dialog', { name: 'QR enrollment: IT 101 · BSIT-1A' });
    const toggle = within(dialog).getByRole('switch', { name: 'Accept enrollments' });
    expect(toggle).not.toBeChecked();
    expect(within(dialog).getByText(/to create this class's QR code/)).toBeInTheDocument();

    await userEvent.click(toggle);
    await waitFor(() => expect(classesApi.setSelfEnrollment).toHaveBeenCalledWith('c1', true));
    expect(await within(dialog).findByRole('img', { name: 'QR code to enroll in IT 101 · BSIT-1A' })).toHaveAttribute('src', 'data:image/png;base64,QR');
    expect(within(dialog).getByLabelText('Enrollment link')).toHaveValue(`${window.location.origin}/join/${TOKEN}`);
    expect(within(dialog).getByRole('link', { name: /Download QR code/ })).toHaveAttribute('download', 'qr-enroll-IT-101-BSIT-1A.png');
    expect(await screen.findByText('Open')).toBeInTheDocument(); // badge on the QR code button
  });

  it('closes enrollment, and "New link" asks first because old QR codes stop working', async () => {
    vi.mocked(classesApi.listClasses).mockResolvedValue([openWithLink]);
    vi.mocked(classesApi.setSelfEnrollment).mockResolvedValue({ ...openWithLink, selfEnrollment: { open: false, token: TOKEN } });
    vi.mocked(classesApi.newSelfEnrollmentLink).mockResolvedValue(openWithLink);
    renderApp('/students?scope=class'); // the QR code button on the class's student list
    await userEvent.click(await screen.findByRole('button', { name: /QR code/ }));
    const dialog = await screen.findByRole('dialog', { name: /QR enrollment/ });
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Accept enrollments' }));
    await waitFor(() => expect(classesApi.setSelfEnrollment).toHaveBeenCalledWith('c1', false));

    await userEvent.click(within(dialog).getByRole('button', { name: /New link/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Create a new link?' });
    expect(confirm).toHaveTextContent('stop working immediately');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Create new link' }));
    await waitFor(() => expect(classesApi.newSelfEnrollmentLink).toHaveBeenCalledWith('c1'));
  });
});

describe('student: the page the QR code opens (no sign-in)', () => {
  const info = { class: { subjectCode: 'IT 101', subjectTitle: 'Introduction to Computing', section: 'BSIT-1A', schoolYear: '2026-2027', semester: 'FIRST' }, instructor: 'Maria Santos', open: true };
  beforeEach(() => {
    vi.mocked(authApi.restoreSession).mockRejectedValue(new Error('signed out'));
  });

  async function fill() {
    await userEvent.type(await screen.findByLabelText(/Student number/), '2025-00777');
    await userEvent.type(screen.getByLabelText(/Last name/), 'Rizal');
    await userEvent.type(screen.getByLabelText(/First name/), 'José');
    await userEvent.type(screen.getByLabelText(/Course/), 'BSIT');
    await userEvent.selectOptions(screen.getByLabelText(/Year level/), '1');
    await userEvent.type(screen.getByLabelText(/Section/), 'A');
    await userEvent.type(screen.getByLabelText(/Email/), 'jose.rizal@evsu.edu.ph');
  }

  it('enrolls the student and confirms', async () => {
    vi.mocked(publicApi.getJoinInfo).mockResolvedValue(info);
    vi.mocked(publicApi.selfEnroll).mockResolvedValue({ class: info.class, student: { studentNumber: '2025-00777', fullName: 'Rizal, José' } });
    renderApp(`/join/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Enroll in IT 101 · BSIT-1A' })).toBeInTheDocument();
    expect(screen.getByText(/Maria Santos/)).toBeInTheDocument();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(publicApi.selfEnroll).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ studentNumber: '2025-00777', lastName: 'Rizal', firstName: 'José', yearLevel: 1, middleName: null, email: 'jose.rizal@evsu.edu.ph' })));
    expect(await screen.findByRole('heading', { name: "You're enrolled" })).toBeInTheDocument();
  });

  it('does not enroll without an email', async () => {
    vi.mocked(publicApi.getJoinInfo).mockResolvedValue(info);
    renderApp(`/join/${TOKEN}`);
    await fill();
    await userEvent.clear(screen.getByLabelText(/Email/));
    await userEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    expect(await screen.findByText('Enter your email.')).toBeInTheDocument();
    expect(publicApi.selfEnroll).not.toHaveBeenCalled();
  });

  it('shows "already enrolled" on the student number field', async () => {
    vi.mocked(publicApi.getJoinInfo).mockResolvedValue(info);
    vi.mocked(publicApi.selfEnroll).mockRejectedValue(new ApiClientError({ status: 422, code: 'VALIDATION_ERROR', message: 'invalid', details: [{ field: 'studentNumber', message: 'Student number 2025-00777 is already enrolled in this class.' }] }));
    renderApp(`/join/${TOKEN}`);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enroll' }));
    expect(await screen.findByText('Student number 2025-00777 is already enrolled in this class.')).toBeInTheDocument();
  });

  it('warns when course, year level, or section differs from the class, and enrolls only if confirmed', async () => {
    vi.mocked(publicApi.getJoinInfo).mockResolvedValue(info);
    vi.mocked(publicApi.selfEnroll)
      .mockRejectedValueOnce(new ApiClientError({
        status: 409, code: 'CLASS_MISMATCH', message: 'This class is for BSIT 1-A, but you entered BSIT 1-C.',
        details: { expected: { course: 'BSIT', yearLevel: 1, section: 'A' }, entered: { course: 'BSIT', yearLevel: 1, section: 'C' }, fields: ['section'] },
      }))
      .mockResolvedValueOnce({ class: info.class, student: { studentNumber: '2025-00777', fullName: 'Rizal, José' } });
    renderApp(`/join/${TOKEN}`);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Enroll' }));

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Are you irregular students?');
    expect(warning).toHaveTextContent('This class is for BSIT 1-A, but you entered BSIT 1-C.');
    expect(screen.getByText('This class is for section A.')).toBeInTheDocument(); // on the Section field
    expect(publicApi.selfEnroll).toHaveBeenLastCalledWith(TOKEN, expect.not.objectContaining({ confirmMismatch: true }));

    await userEvent.click(within(warning).getByRole('button', { name: 'Enroll anyway' }));
    await waitFor(() => expect(publicApi.selfEnroll).toHaveBeenLastCalledWith(TOKEN, expect.objectContaining({ confirmMismatch: true })));
    expect(await screen.findByRole('heading', { name: "You're enrolled" })).toBeInTheDocument();
  });

  it('says when enrollment is closed, and when the link is not valid', async () => {
    vi.mocked(publicApi.getJoinInfo).mockResolvedValueOnce({ ...info, open: false });
    const { unmount } = renderApp(`/join/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Enrollment is closed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enroll' })).not.toBeInTheDocument();
    unmount();

    vi.mocked(publicApi.getJoinInfo).mockRejectedValueOnce(new ApiClientError({ status: 404, code: 'NOT_FOUND', message: 'This enrollment link is not valid. Ask your instructor for the current QR code.' }));
    renderApp('/join/old-link-1234567890');
    expect(await screen.findByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
    expect(screen.getByText(/Ask your instructor for the current QR code/)).toBeInTheDocument();
  });
});
