/**
 * Support chat: the Gradify AI assistant (Noupe).
 *
 * The assistant is shown inside a frame in Gradify's own chat box (pages/auth/SupportChat.jsx).
 * Noupe's embed script is NOT used: nothing from outside runs in Gradify's pages, so it cannot
 * read what is typed on the sign-in page, and the Content-Security-Policy only has to allow
 * showing www.noupe.com in a frame.
 *
 * The address is https://www.noupe.com/agent/<agent id>; the id is public (it is the one in Noupe's
 * embed code). VITE_SUPPORT_CHAT_URL replaces the address below, and setting it to an empty value
 * turns the chat off. Anything that is not a Noupe agent address is ignored, so a typo cannot put
 * an unexpected site in the frame.
 */
const DEFAULT_AGENT = 'https://www.noupe.com/agent/01a2163287a0700084ae001465b13410d986';
const NOUPE_AGENT = /^https:\/\/www\.noupe\.com\/agent\/[a-z0-9]+$/i;
// The same options Noupe's own embed passes to the chat page.
const OPTIONS = 'skipWelcome=1&isNoupeAgent=1&isNoupeLogo=1&noupeSelectedColor=%23770206';

/** The address to show in the chat frame, or null when the chat is turned off. */
export function supportChatUrl(raw = import.meta.env.VITE_SUPPORT_CHAT_URL) {
  const value = String(raw ?? DEFAULT_AGENT).trim();
  return NOUPE_AGENT.test(value) ? `${value}?${OPTIONS}` : null;
}
