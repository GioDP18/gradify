import { apiClient } from './apiClient';

const data = (response) => response.data.data;

/** Whether the assistant is set up on the server: { available }. */
export const getAssistant = () => apiClient.get('/assistant').then(data);

/**
 * Asks the assistant. `messages` is the conversation so far, oldest first, ending with the
 * question: [{ role: 'user' | 'assistant', content }]. `chatId` is the saved chat it continues
 * (none for a new chat). Resolves to { reply, chat }: `chat` is { id, title, updatedAt } when the
 * account keeps its chat history (the conversation was saved there), otherwise null.
 */
export const sendChat = (messages, chatId) =>
  apiClient.post('/assistant/chat', { messages: messages.map(({ role, content }) => ({ role, content })), ...(chatId ? { chatId } : {}) }, { timeout: 90000 }).then(data);

/** The account's saved chats, newest first: [{ id, title, updatedAt }]. */
export const listChats = () => apiClient.get('/assistant/chats').then(data);

/** One saved chat with its messages: { id, title, updatedAt, messages }. */
export const getChat = (id) => apiClient.get(`/assistant/chats/${id}`).then(data);

export const deleteChat = (id) => apiClient.delete(`/assistant/chats/${id}`).then(data);
