import { apiClient } from './apiClient';

/** Whether the assistant is set up on the server: { available }. */
export const getAssistant = () => apiClient.get('/assistant').then((r) => r.data.data);

/**
 * Asks the assistant. `messages` is the conversation so far, oldest first, ending with the
 * question: [{ role: 'user' | 'assistant', content }]. Resolves to { reply }.
 */
export const sendChat = (messages) =>
  apiClient.post('/assistant/chat', { messages: messages.map(({ role, content }) => ({ role, content })) }, { timeout: 40000 }).then((r) => r.data.data);
