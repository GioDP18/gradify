import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, instructor, sampleClass } from './renderApp';
import * as authApi from '../services/authApi';
import * as assistantApi from '../services/assistantApi';
import * as classesApi from '../services/classesApi';
import { ApiClientError } from '../services/apiClient';

vi.mock('../services/authApi', () => ({ restoreSession: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('../services/classesApi', () => ({ listClasses: vi.fn() }));
vi.mock('../services/assistantApi', () => ({ getAssistant: vi.fn(), sendChat: vi.fn() }));

const admin = { ...instructor, id: 'a1', name: 'Ada Admin', role: 'ADMIN' };
const LONG = { timeout: 15000 };

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(authApi.restoreSession).mockReset().mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockReset().mockResolvedValue([sampleClass]);
  vi.mocked(assistantApi.getAssistant).mockReset().mockResolvedValue({ available: true });
  vi.mocked(assistantApi.sendChat).mockReset().mockResolvedValue({ reply: 'Final percentage = **Midterm × 40%** + Finals × 60%.' });
});

const openAssistant = async () => {
  renderApp('/assistant');
  return screen.findByRole('region', { name: 'Gradify Assistant' }, LONG);
};

describe('Assistant page', () => {
  it('is in the sidebar and greets the instructor with suggested questions', async () => {
    const chat = await openAssistant();
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/assistant');
    expect(within(chat).getByRole('heading', { name: 'Hi Maria, how can I help?' })).toBeInTheDocument();
    expect(within(chat).getByRole('button', { name: 'How is the final grade computed?' })).toBeInTheDocument();
    expect(within(chat).getByText(/cannot see your classes or grades/)).toBeInTheDocument();
    expect(within(chat).getByRole('button', { name: 'New chat' })).toBeDisabled();
  });

  it('asks a suggested question, shows the answer with its formatting, and keeps the conversation going', async () => {
    const chat = await openAssistant();

    let answer;
    vi.mocked(assistantApi.sendChat).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await userEvent.click(within(chat).getByRole('button', { name: 'How is the final grade computed?' }));
    expect(assistantApi.sendChat).toHaveBeenCalledWith([{ role: 'user', content: 'How is the final grade computed?' }]);
    // while the answer is on its way, a typing bubble shows where it will appear
    expect(chat.querySelector('.evsu-assistant__typing .cs-typing-indicator__dot')).not.toBeNull();
    expect(within(chat).getByText('The assistant is typing')).toBeInTheDocument();
    answer({ reply: 'Final percentage = **Midterm × 40%** + Finals × 60%.' });
    expect(await within(chat).findByText('Midterm × 40%')).toContainHTML('<strong>Midterm × 40%</strong>');
    expect(within(chat).getByText('How is the final grade computed?')).toBeInTheDocument();
    expect(within(chat).queryByRole('list', { name: 'Suggested questions' })).not.toBeInTheDocument();
    expect(chat.querySelector('.evsu-assistant__typing')).toBeNull();

    // the answer can be copied
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(within(chat).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Final percentage = **Midterm × 40%** + Finals × 60%.');
    expect(await within(chat).findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    // a typed follow-up sends the whole conversation
    vi.mocked(assistantApi.sendChat).mockResolvedValue({ reply: 'Passing is 3.0 (75%).' });
    const input = chat.querySelector('.cs-message-input__content-editor');
    expect(within(chat).getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    await userEvent.click(input);
    await userEvent.keyboard('What is the passing grade?{Enter}');
    await waitFor(() => expect(assistantApi.sendChat).toHaveBeenCalledTimes(2));
    expect(vi.mocked(assistantApi.sendChat).mock.calls[1][0]).toEqual([
      { role: 'user', content: 'How is the final grade computed?' },
      { role: 'assistant', content: 'Final percentage = **Midterm × 40%** + Finals × 60%.' },
      { role: 'user', content: 'What is the passing grade?' },
    ]);
    expect(await within(chat).findByText('Passing is 3.0 (75%).')).toBeInTheDocument();
  });

  it('never renders HTML from an answer', async () => {
    vi.mocked(assistantApi.sendChat).mockResolvedValue({ reply: 'Hello <img src=x onerror="window.hacked = true"> <script>window.hacked = true</script> there' });
    const chat = await openAssistant();
    await userEvent.click(within(chat).getByRole('button', { name: 'Why does a student show INC?' }));
    await within(chat).findByText(/Hello/);
    expect(chat.querySelector('.evsu-assistant__answer img, .evsu-assistant__answer script')).toBeNull();
    expect(window.hacked).toBeUndefined();
  });

  it('says so when the answer fails, and "Try again" asks the same question', async () => {
    vi.mocked(assistantApi.sendChat).mockRejectedValueOnce(new ApiClientError({ status: 503, code: 'ASSISTANT_BUSY', message: 'The assistant is busy right now. Wait a minute and try again.' }));
    const chat = await openAssistant();
    await userEvent.click(within(chat).getByRole('button', { name: 'Why does a student show INC?' }));
    expect(await within(chat).findByRole('alert')).toHaveTextContent('The assistant is busy right now. Wait a minute and try again.');

    vi.mocked(assistantApi.sendChat).mockResolvedValue({ reply: 'A required score is missing.' });
    await userEvent.click(within(chat).getByRole('button', { name: 'Try again' }));
    expect(await within(chat).findByText('A required score is missing.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.sendChat).mock.calls[1][0]).toEqual([{ role: 'user', content: 'Why does a student show INC?' }]);
    expect(within(chat).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the conversation for this tab, and "New chat" clears it', async () => {
    sessionStorage.setItem('gradify-assistant:u1', JSON.stringify([{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }]));
    const chat = await openAssistant();
    expect(within(chat).getByText('Earlier answer')).toBeInTheDocument();

    await userEvent.click(within(chat).getByRole('button', { name: 'New chat' }));
    expect(within(chat).queryByText('Earlier answer')).not.toBeInTheDocument();
    expect(within(chat).getByRole('heading', { name: 'Hi Maria, how can I help?' })).toBeInTheDocument();
    expect(sessionStorage.getItem('gradify-assistant:u1')).toBeNull();
  });

  it('explains when the assistant is not turned on', async () => {
    vi.mocked(assistantApi.getAssistant).mockResolvedValue({ available: false });
    const chat = await openAssistant();
    expect(await within(chat).findByText(/The assistant is not turned on yet\. Ask your Gradify administrator/)).toBeInTheDocument();
    expect(within(chat).queryByRole('list', { name: 'Suggested questions' })).not.toBeInTheDocument();
    expect(assistantApi.sendChat).not.toHaveBeenCalled();
  });

  it('is available to the administrator, with their own suggestions', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue(admin);
    const chat = await openAssistant();
    expect(screen.getByRole('link', { name: 'Chat' })).toBeInTheDocument();
    expect(within(chat).getByRole('button', { name: 'How do I create an instructor account?' })).toBeInTheDocument();
  });
});
