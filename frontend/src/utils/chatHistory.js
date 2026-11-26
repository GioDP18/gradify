/**
 * Helpers for the assistant's chat history.
 *
 * The history itself is saved to the person's ACCOUNT on the server (services/assistantApi.js), so
 * it is the same on every device and browser. Nothing is kept in the browser.
 */
const PREFIX = 'gradify-assistant:';

/**
 * An earlier version kept conversations in the browser's own storage. Anything it left behind is
 * removed, so copies of conversations do not stay on a computer.
 */
export function clearChatHistory() {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      Object.keys(storage).filter((k) => k.startsWith(PREFIX)).forEach((k) => storage.removeItem(k));
    } catch { /* nothing to clear */ }
  }
}

/** "Today", "Yesterday", "Earlier this week" or "Older", for grouping the list of chats. */
export function chatDayLabel(updatedAt, now = Date.now()) {
  const day = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((day(now) - day(updatedAt)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  return 'Older';
}
