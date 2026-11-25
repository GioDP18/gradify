import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActionButton from '../components/common/ActionButton';

describe('ActionButton', () => {
  it('is disabled with a spinner while its action runs, and ignores further clicks', async () => {
    let finish;
    const action = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<ActionButton className="btn" onClick={action} busyLabel="Saving…">Save</ActionButton>);

    const button = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Saving…');
    expect(button.querySelector('.spinner-border')).not.toBeNull();

    await userEvent.click(button);
    button.click(); // even a click that gets past the disabled state
    expect(action).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveTextContent('Save');
    expect(button.querySelector('.spinner-border')).toBeNull();
  });

  it('becomes usable again when the action fails, and follows the busy prop', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('nope')).catch(() => {}));
    const { rerender } = render(<ActionButton onClick={failing}>Retry</ActionButton>);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled());

    rerender(<ActionButton onClick={failing} busy>Retry</ActionButton>);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
});
