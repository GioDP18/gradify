import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as classesApi from '../services/classesApi';
import { ApiClientError } from '../services/apiClient';
import { toSquareAvatar } from '../utils/resizeImage';

vi.mock('../services/authApi', () => ({
  restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn(), updateProfile: vi.fn(), changePassword: vi.fn(),
  uploadAvatar: vi.fn(), removeAvatar: vi.fn(), fetchAvatar: vi.fn(),
}));
// Canvas resizing is a browser feature; here it returns a small stand-in image.
vi.mock('../utils/resizeImage', () => ({ ACCEPTED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'], toSquareAvatar: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));

const me = { ...instructor, username: 'maria', lastLoginAt: '2026-11-22T01:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.restoreSession).mockResolvedValue(me);
  vi.mocked(classesApi.listClasses).mockResolvedValue([sampleClass]);
});

describe('manage profile', () => {
  it('opens from the profile button in the header', async () => {
    const { router } = renderApp('/classes');
    await userEvent.click(await screen.findByRole('button', { name: /Maria Santos/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Manage profile' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));
    expect(await screen.findByRole('heading', { name: 'Profile details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My profile', level: 1 })).toBeInTheDocument();
  });

  it('saves a new name without asking for the password and updates the header', async () => {
    vi.mocked(authApi.updateProfile).mockResolvedValue({ ...me, name: 'Maria Santos-Reyes' });
    renderApp('/profile');
    const name = await screen.findByLabelText(/Full name/);
    const details = screen.getByRole('region', { name: 'Profile details' });
    expect(within(details).queryByLabelText(/Current password/)).not.toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, 'Maria Santos-Reyes');
    await userEvent.click(within(details).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(authApi.updateProfile).toHaveBeenCalledWith({ name: 'Maria Santos-Reyes', email: me.email, username: 'maria' }));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Maria Santos-Reyes/ })).toBeInTheDocument(); // header
  });

  it('asks for the current password when the email changes and shows server errors on the field', async () => {
    vi.mocked(authApi.updateProfile).mockRejectedValue(new ApiClientError({ status: 422, code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ field: 'currentPassword', message: 'Current password is incorrect.' }] }));
    renderApp('/profile');
    const details = await screen.findByRole('region', { name: 'Profile details' });
    const email = within(details).getByLabelText(/Email/);
    await userEvent.clear(email);
    await userEvent.type(email, 'maria.new@evsu.edu.ph');
    const password = within(details).getByLabelText(/Current password/);
    await userEvent.click(within(details).getByRole('button', { name: 'Save changes' }));
    expect(await within(details).findByText('Enter your current password.')).toBeInTheDocument();
    expect(authApi.updateProfile).not.toHaveBeenCalled();

    await userEvent.type(password, 'wrong-one');
    await userEvent.click(within(details).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(authApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ email: 'maria.new@evsu.edu.ph', currentPassword: 'wrong-one' })));
    expect(await within(details).findByText('Current password is incorrect.')).toBeInTheDocument();
  });

  it('changes the password once every rule is met and both entries match', async () => {
    vi.mocked(authApi.changePassword).mockResolvedValue({ otherSessionsSignedOut: 2 });
    renderApp('/profile');
    const section = await screen.findByRole('region', { name: 'Change password' });
    await userEvent.type(within(section).getByLabelText(/Current password/), 'Old-Password-123!');
    await userEvent.type(within(section).getByLabelText(/^New password/), 'short');
    expect(within(section).getByText('At least 12 characters')).toHaveTextContent('(not yet)');
    await userEvent.click(within(section).getByRole('button', { name: 'Change password' }));
    expect(await within(section).findByText(/does not meet all the requirements/)).toBeInTheDocument();
    expect(authApi.changePassword).not.toHaveBeenCalled();

    const next = within(section).getByLabelText(/^New password/);
    await userEvent.clear(next);
    await userEvent.type(next, 'Fresh-Passw0rd-2026');
    await userEvent.type(within(section).getByLabelText(/Confirm new password/), 'Fresh-Passw0rd-2027');
    await userEvent.click(within(section).getByRole('button', { name: 'Change password' }));
    expect(await within(section).findByText('The passwords do not match.')).toBeInTheDocument();

    const confirm = within(section).getByLabelText(/Confirm new password/);
    await userEvent.clear(confirm);
    await userEvent.type(confirm, 'Fresh-Passw0rd-2026');
    await userEvent.click(within(section).getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledWith({ currentPassword: 'Old-Password-123!', newPassword: 'Fresh-Passw0rd-2026' }));
    expect(await screen.findByText('Password changed. Signed out 2 other sessions.')).toBeInTheDocument();
  });

  it('uploads a resized profile photo, shows it in the header, and removes it', async () => {
    const small = new Blob(['img'], { type: 'image/webp' });
    vi.mocked(toSquareAvatar).mockResolvedValue(small);
    vi.mocked(authApi.uploadAvatar).mockResolvedValue({ ...me, avatarUpdatedAt: '2026-11-22T05:00:00.000Z' });
    vi.mocked(authApi.removeAvatar).mockResolvedValue({ ...me, avatarUpdatedAt: null });
    URL.createObjectURL = vi.fn(() => 'blob:avatar');
    URL.revokeObjectURL = vi.fn();
    const { container } = renderApp('/profile');

    expect(await screen.findByRole('button', { name: 'Upload a profile photo' })).toBeInTheDocument();
    const photo = new File(['raw'], 'me.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByTestId('avatar-input'), photo);
    // A preview opens first; nothing is uploaded until Save.
    const preview = await screen.findByRole('dialog', { name: 'New profile photo' });
    expect(toSquareAvatar).toHaveBeenCalledWith(photo);
    expect(within(preview).getByRole('img', { name: 'Preview of your new profile photo' })).toHaveAttribute('src', 'blob:avatar');
    expect(authApi.uploadAvatar).not.toHaveBeenCalled();
    await userEvent.click(within(preview).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(authApi.uploadAvatar).toHaveBeenCalledWith(small));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Profile photo updated.')).toBeInTheDocument();
    // The uploaded image is reused: nothing is downloaded again.
    await waitFor(() => expect(container.querySelector('.evsu-profile__avatar.has-photo img')).not.toBeNull());
    // The header's profile button shows the same photo.
    expect(container.querySelector('.evsu-account-btn .evsu-avatar.has-photo img')).not.toBeNull();
    expect(authApi.fetchAvatar).not.toHaveBeenCalled();

    // Remove happens in the photo viewer (opened by clicking the avatar).
    await userEvent.click(screen.getByRole('button', { name: 'View profile photo' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove photo' }));
    expect(await screen.findByText('Profile photo removed.')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.evsu-avatar.has-photo')).toBeNull());
    expect(screen.getByRole('button', { name: 'Upload a profile photo' })).toBeInTheDocument();
  });

  it('explains when a photo cannot be used', async () => {
    vi.mocked(toSquareAvatar).mockRejectedValue(new Error('Choose a JPEG, PNG, or WebP image.'));
    renderApp('/profile');
    await screen.findByRole('button', { name: 'Upload a profile photo' });
    await userEvent.upload(screen.getByTestId('avatar-input'), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText('Choose a JPEG, PNG, or WebP image.')).toBeInTheDocument();
    expect(authApi.uploadAvatar).not.toHaveBeenCalled();
  });

  it('clicking the avatar shows the photo in full, with change and remove', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue({ ...me, avatarUpdatedAt: '2026-11-22T05:00:00.000Z' });
    vi.mocked(authApi.fetchAvatar).mockResolvedValue(new Blob(['img'], { type: 'image/webp' }));
    vi.mocked(authApi.removeAvatar).mockResolvedValue({ ...me, avatarUpdatedAt: null });
    URL.createObjectURL = vi.fn(() => 'blob:avatar');
    URL.revokeObjectURL = vi.fn();
    renderApp('/profile');

    await userEvent.click(await screen.findByRole('button', { name: 'View profile photo' }));
    const viewer = await screen.findByRole('dialog', { name: 'Profile photo' });
    expect(await within(viewer).findByRole('img', { name: 'Profile photo of Maria Santos' })).toHaveAttribute('src', 'blob:avatar');
    expect(authApi.fetchAvatar).toHaveBeenCalledWith('2026-11-22T05:00:00.000Z');
    expect(within(viewer).getByRole('button', { name: 'Change photo' })).toBeEnabled();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'View profile photo' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove photo' }));
    expect(await screen.findByText('Profile photo removed.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Without a photo, the avatar asks for one instead.
    expect(screen.getByRole('button', { name: 'Upload a profile photo' })).toBeInTheDocument();
  });

  it('cancelling the preview keeps the current photo and uploads nothing', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue({ ...me, avatarUpdatedAt: '2026-11-22T05:00:00.000Z' });
    vi.mocked(authApi.fetchAvatar).mockResolvedValue(new Blob(['old'], { type: 'image/webp' }));
    vi.mocked(toSquareAvatar).mockResolvedValue(new Blob(['new'], { type: 'image/webp' }));
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderApp('/profile');

    await userEvent.click(await screen.findByRole('button', { name: 'View profile photo' }));
    const viewer = await screen.findByRole('dialog', { name: 'Profile photo' });
    await userEvent.click(within(viewer).getByRole('button', { name: 'Change photo' }));
    await userEvent.upload(screen.getByTestId('avatar-input'), new File(['raw'], 'me.png', { type: 'image/png' }));
    const preview = await screen.findByRole('dialog', { name: 'New profile photo' });
    expect(within(preview).getByRole('button', { name: 'Choose another' })).toBeEnabled();

    await userEvent.click(within(preview).getByRole('button', { name: 'Cancel' }));
    // Back to the saved photo; nothing was uploaded.
    expect(await screen.findByRole('dialog', { name: 'Profile photo' })).toBeInTheDocument();
    expect(authApi.uploadAvatar).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
