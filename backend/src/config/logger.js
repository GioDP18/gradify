/* Minimal leveled logger. Never pass secrets, tokens, or password data to it. */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configured = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info');
const threshold = LEVELS[configured] ?? LEVELS.info;

function write(level, args) {
  if (LEVELS[level] > threshold) return;
  const line = [`[${new Date().toISOString()}] ${level.toUpperCase()}:`, ...args];
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(...line);
}

export const logger = {
  error: (...args) => write('error', args),
  warn: (...args) => write('warn', args),
  info: (...args) => write('info', args),
  debug: (...args) => write('debug', args),
};
