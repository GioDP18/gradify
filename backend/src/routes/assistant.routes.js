import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.validators.js';
import { assistantLimiter } from '../middleware/rateLimit.js';
import { askAssistant, isAssistantAvailable, MAX_MESSAGES, MAX_MESSAGE_LENGTH } from '../services/assistant/assistant.service.js';
import * as history from '../services/assistant/chatHistory.service.js';
import { sendSuccess } from '../utils/response.js';

/** The in-app assistant (instructors and the administrator). */
const router = Router();

// The conversation so far, oldest first, ending with the question being asked. The server adds
// its own instructions; a "system" message from the browser is never accepted.
const chatRules = [
  body('messages').isArray({ min: 1, max: MAX_MESSAGES }).withMessage('Type a question first.').bail()
    .custom((messages) => messages.at(-1)?.role === 'user').withMessage('Type a question first.'),
  body('messages.*.role').isIn(['user', 'assistant']).withMessage('That message could not be sent. Start a new chat and try again.'),
  body('messages.*.content').isString().withMessage('That message could not be sent. Start a new chat and try again.').bail()
    .trim().isLength({ min: 1, max: MAX_MESSAGE_LENGTH * 4 }).withMessage('That message is too long. Shorten it and try again.'),
  // What the person typed is held to the shorter limit (answers from the assistant may be longer).
  body('messages').custom((messages) => messages.every((m) => m?.role !== 'user' || String(m.content ?? '').trim().length <= MAX_MESSAGE_LENGTH))
    .withMessage(`That message is too long. Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters.`),
  // The saved chat this conversation continues (none for a new chat).
  body('chatId').optional({ values: 'null' }).isMongoId().withMessage('That chat could not be continued. Start a new chat and try again.'),
];

router.get('/', (req, res) => sendSuccess(res, { available: isAssistantAvailable() }));

/**
 * Answers the question. When the account keeps its chat history, the conversation (with the new
 * answer) is saved to it and `chat` says where: { id, title, updatedAt }; otherwise `chat` is null.
 */
router.post('/chat', assistantLimiter, validate(chatRules), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { messages, chatId } = req.body;
  const { reply } = await askAssistant(messages, req.user);
  const chat = await history.saveConversation(req.user.id, chatId, [...messages, { role: 'assistant', content: reply }]);
  sendSuccess(res, { reply, chat });
});

// Saved chats of the signed-in account (the same on every device).
router.get('/chats', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await history.listChats(req.user.id));
});
router.get('/chats/:id', validate([idParam()]), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await history.getChat(req.user.id, req.params.id));
});
router.delete('/chats/:id', validate([idParam()]), async (req, res) => {
  await history.deleteChat(req.user.id, req.params.id);
  sendSuccess(res, { deleted: true });
});

export default router;
