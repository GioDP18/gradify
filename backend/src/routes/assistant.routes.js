import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { assistantLimiter } from '../middleware/rateLimit.js';
import { askAssistant, isAssistantAvailable, MAX_MESSAGES, MAX_MESSAGE_LENGTH } from '../services/assistant/assistant.service.js';
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
];

router.get('/', (req, res) => sendSuccess(res, { available: isAssistantAvailable() }));

router.post('/chat', assistantLimiter, validate(chatRules), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, await askAssistant(req.body.messages, req.user.role));
});

export default router;
