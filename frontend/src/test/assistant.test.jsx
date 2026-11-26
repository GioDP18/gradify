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
vi.mock('../services/assistantApi', () => ({ getAssistant: vi.fn(), sendChat: vi.fn(), listChats: vi.fn(), getChat: vi.fn(), deleteChat: vi.fn() }));

const admin = { ...instructor, id: 'a1', name: 'Ada Admin', role: 'ADMIN' };
const LONG = { timeout: 15000 };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.mocked(authApi.restoreSession).mockReset().mockResolvedValue(instructor);
  vi.mocked(classesApi.listClasses).mockReset().mockResolvedValue([sampleClass]);
  vi.mocked(assistantApi.getAssistant).mockReset().mockResolvedValue({ available: true });
  vi.mocked(assistantApi.sendChat).mockReset().mockResolvedValue({ reply: 'Final percentage = **Midterm × 40%** + Finals × 60%.', chat: null });
  vi.mocked(assistantApi.listChats).mockReset().mockResolvedValue([]);
  vi.mocked(assistantApi.getChat).mockReset();
  vi.mocked(assistantApi.deleteChat).mockReset().mockResolvedValue({ deleted: true });
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
    expect(within(chat).getByText(/can look up your own classes, students and grades/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled();
    expect(await screen.findByText('Your chats will be listed here.')).toBeInTheDocument();
  });

  it('asks a suggested question, shows the answer with its formatting, and keeps the conversation going', async () => {
    const chat = await openAssistant();

    let answer;
    vi.mocked(assistantApi.sendChat).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await userEvent.click(within(chat).getByRole('button', { name: 'How is the final grade computed?' }));
    expect(assistantApi.sendChat).toHaveBeenCalledWith([{ role: 'user', content: 'How is the final grade computed?' }], null);
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
    await userEvent.click(within(chat).getByRole('button', { name: 'Which students are failing?' }));
    await within(chat).findByText(/Hello/);
    expect(chat.querySelector('.evsu-assistant__answer img, .evsu-assistant__answer script')).toBeNull();
    expect(window.hacked).toBeUndefined();
  });

  it('says so when the answer fails, and "Try again" asks the same question', async () => {
    vi.mocked(assistantApi.sendChat).mockRejectedValueOnce(new ApiClientError({ status: 503, code: 'ASSISTANT_BUSY', message: 'The assistant is busy right now. Wait a minute and try again.' }));
    const chat = await openAssistant();
    await userEvent.click(within(chat).getByRole('button', { name: 'Which students are failing?' }));
    expect(await within(chat).findByRole('alert')).toHaveTextContent('The assistant is busy right now. Wait a minute and try again.');

    vi.mocked(assistantApi.sendChat).mockResolvedValue({ reply: 'A required score is missing.' });
    await userEvent.click(within(chat).getByRole('button', { name: 'Try again' }));
    expect(await within(chat).findByText('A required score is missing.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.sendChat).mock.calls[1][0]).toEqual([{ role: 'user', content: 'Which students are failing?' }]);
    expect(within(chat).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists the account\'s saved chats on the left: open one, start a new one, delete one', async () => {
    const now = Date.now();
    const iso = (t) => new Date(t).toISOString();
    vi.mocked(assistantApi.listChats).mockResolvedValue([
      { id: 'c2', title: 'Who is failing?', updatedAt: iso(now) },
      { id: 'c1', title: 'Old question', updatedAt: iso(now - 3 * 86400000) },
    ]);
    vi.mocked(assistantApi.getChat).mockImplementation(async (id) => ({
      c2: { id: 'c2', title: 'Who is failing?', messages: [{ role: 'user', content: 'Who is failing?' }, { role: 'assistant', content: 'Nobody is failing.' }] },
      c1: { id: 'c1', title: 'Old question', messages: [{ role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' }] },
    })[id]);
    const chat = await openAssistant();
    const history = screen.getByRole('navigation', { name: 'Chat history' });

    // the page opens on a new chat, with the saved ones listed by day
    expect(within(chat).getByRole('heading', { name: 'Hi Maria, how can I help?' })).toBeInTheDocument();
    expect(await within(history).findByRole('button', { name: 'Who is failing?' })).not.toHaveAttribute('aria-current');
    expect(within(within(history).getByRole('region', { name: 'Today' })).getAllByRole('listitem')).toHaveLength(1);
    expect(within(history).getByRole('region', { name: 'Earlier this week' })).toBeInTheDocument();

    // open a saved one, then continue it: the question goes with that chat's id
    await userEvent.click(within(history).getByRole('button', { name: 'Old question' }));
    expect(await within(chat).findByText('Old answer')).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Old question' })).toHaveAttribute('aria-current', 'true');
    vi.mocked(assistantApi.sendChat).mockResolvedValueOnce({ reply: 'More detail.', chat: { id: 'c1', title: 'Old question', updatedAt: iso(now + 1000) } });
    await userEvent.click(chat.querySelector('.cs-message-input__content-editor'));
    await userEvent.keyboard('Tell me more{Enter}');
    expect(await within(chat).findByText('More detail.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.sendChat).mock.calls[0][1]).toBe('c1');
    // it moves to the top of the list, under Today
    await waitFor(() => expect(within(within(history).getByRole('region', { name: 'Today' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Old question', 'Who is failing?']));

    // a new chat starts without an id and is filed by the server on its first answer
    await userEvent.click(within(history).getByRole('button', { name: 'New chat' }));
    expect(within(chat).getByRole('heading', { name: 'Hi Maria, how can I help?' })).toBeInTheDocument();
    vi.mocked(assistantApi.sendChat).mockResolvedValueOnce({ reply: 'You have 2 classes.', chat: { id: 'c3', title: 'How many classes and students do I have?', updatedAt: iso(now + 2000) } });
    await userEvent.click(within(chat).getByRole('button', { name: 'How many classes and students do I have?' }));
    expect(await within(chat).findByText('You have 2 classes.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.sendChat).mock.calls[1][1]).toBeNull();
    expect(within(history).getByRole('button', { name: 'How many classes and students do I have?' })).toHaveAttribute('aria-current', 'true');

    // delete asks first, then removes it from the account and the list; the open chat is untouched
    await userEvent.click(within(history).getByRole('button', { name: 'Delete chat: Who is failing?' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    expect(assistantApi.deleteChat).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(history).queryByRole('button', { name: 'Who is failing?' })).not.toBeInTheDocument());
    expect(assistantApi.deleteChat).toHaveBeenCalledWith('c2');
    expect(within(chat).getByText('You have 2 classes.')).toBeInTheDocument();

    // nothing is kept in the browser
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('deleting the open chat returns to a new chat, and a failed delete says so', async () => {
    vi.mocked(assistantApi.listChats).mockResolvedValue([{ id: 'c1', title: 'Old question', updatedAt: new Date().toISOString() }]);
    vi.mocked(assistantApi.getChat).mockResolvedValue({ id: 'c1', title: 'Old question', messages: [{ role: 'user', content: 'Old question' }, { role: 'assistant', content: 'Old answer' }] });
    const chat = await openAssistant();
    const history = screen.getByRole('navigation', { name: 'Chat history' });
    await userEvent.click(await within(history).findByRole('button', { name: 'Old question' }));
    await within(chat).findByText('Old answer');

    vi.mocked(assistantApi.deleteChat).mockRejectedValueOnce(new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server.' }));
    await userEvent.click(within(history).getByRole('button', { name: 'Delete chat: Old question' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this chat?' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Old question' })).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this chat?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(history).queryByRole('button', { name: 'Old question' })).not.toBeInTheDocument());
    expect(within(chat).getByRole('heading', { name: 'Hi Maria, how can I help?' })).toBeInTheDocument();
    expect(await within(history).findByText('Your chats will be listed here.')).toBeInTheDocument();
  });

  it('removes conversations an earlier version left in the browser', async () => {
    localStorage.setItem('gradify-assistant:u1', JSON.stringify([{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }]));
    sessionStorage.setItem('gradify-assistant:u1', '[]');
    localStorage.setItem('something-else', 'kept');
    const chat = await openAssistant();
    expect(within(chat).queryByText('Earlier answer')).not.toBeInTheDocument();
    expect(localStorage.getItem('gradify-assistant:u1')).toBeNull();
    expect(sessionStorage.getItem('gradify-assistant:u1')).toBeNull();
    expect(localStorage.getItem('something-else')).toBe('kept');
  });

  it('has no history panel and saves nothing when chat history is turned off in Settings', async () => {
    vi.mocked(authApi.restoreSession).mockResolvedValue({ ...instructor, preferences: { workingClass: true, chatHistory: false } });
    const chat = await openAssistant();
    expect(screen.queryByRole('navigation', { name: 'Chat history' })).not.toBeInTheDocument();
    expect(assistantApi.listChats).not.toHaveBeenCalled();

    await userEvent.click(within(chat).getByRole('button', { name: 'Which students are failing?' }));
    await within(chat).findByText('Midterm × 40%');
    // "New chat" sits in the header instead
    await userEvent.click(within(chat).getByRole('button', { name: 'New chat' }));
    expect(within(chat).getByRole('heading', { name: 'Hi Maria, how can I help?' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
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
