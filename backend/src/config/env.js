import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isIP } from 'node:net';

const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

// Values already present in process.env (e.g. set by the host or test runner) take precedence.
if (existsSync(ENV_FILE) && process.env.NODE_ENV !== 'test') {
  process.loadEnvFile(ENV_FILE);
}

const NODE_ENVS = ['development', 'production', 'test'];
const DURATION_PATTERN = /^\d+[smhd]$/;

function requireString(source, key, errors) {
  const value = source[key]?.trim();
  if (!value) errors.push(`${key} is required`);
  return value;
}

function toInt(source, key, fallback, { min, max }, errors) {
  const raw = source[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function toBool(source, key, fallback, errors) {
  const raw = source[key];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') errors.push(`${key} must be "true" or "false"`);
  return raw === 'true';
}

/**
 * Builds and validates the application configuration.
 * Fails fast with every problem listed, so a misconfigured deployment never starts.
 */
export function loadConfig(source = process.env) {
  const errors = [];

  // On Vercel a missing NODE_ENV must not silently mean "development" (stack traces in errors, a
  // non-Secure cookie, no TRUST_PROXY check).
  if (!source.NODE_ENV && source.VERCEL) errors.push('NODE_ENV must be set on Vercel (use production)');
  const nodeEnv = source.NODE_ENV || 'development';
  if (!NODE_ENVS.includes(nodeEnv)) errors.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}`);

  const mongodbUri = requireString(source, 'MONGODB_URI', errors);
  if (mongodbUri && !/^mongodb(\+srv)?:\/\//.test(mongodbUri)) {
    errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  const accessSecret = requireString(source, 'JWT_ACCESS_SECRET', errors);
  const refreshSecret = requireString(source, 'JWT_REFRESH_SECRET', errors);
  if (accessSecret && accessSecret.length < 32) errors.push('JWT_ACCESS_SECRET must be at least 32 characters');
  if (refreshSecret && refreshSecret.length < 32) errors.push('JWT_REFRESH_SECRET must be at least 32 characters');
  if (accessSecret && accessSecret === refreshSecret) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }

  const accessExpires = source.JWT_ACCESS_EXPIRES || '15m';
  if (!DURATION_PATTERN.test(accessExpires)) errors.push('JWT_ACCESS_EXPIRES must look like 15m, 1h, 30s');

  const clientUrls = (source.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const url of clientUrls) {
    if (!/^https?:\/\/[^/]+$/.test(url)) errors.push(`CLIENT_URL entry "${url}" must be an origin like http://localhost:5173`);
  }

  const dnsServers = (source.DNS_SERVERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const server of dnsServers) {
    if (!isIP(server)) errors.push(`DNS_SERVERS entry "${server}" must be an IP address`);
  }

  const config = {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    // Stack traces in error responses: local development only, never on a hosted deployment.
    exposeErrorStacks: nodeEnv === 'development' && !source.VERCEL,
    port: toInt(source, 'PORT', 5000, { min: 1, max: 65535 }, errors),
    trustProxy: toInt(source, 'TRUST_PROXY', 0, { min: 0, max: 10 }, errors),
    mongodb: {
      uri: mongodbUri,
      dbName: source.MONGODB_DB_NAME?.trim() || 'evsu_grading_system',
      dnsServers,
    },
    jwt: {
      accessSecret,
      refreshSecret,
      accessExpires,
      refreshExpiresDays: toInt(source, 'JWT_REFRESH_EXPIRES_DAYS', 7, { min: 1, max: 90 }, errors),
      refreshRememberDays: toInt(source, 'JWT_REFRESH_REMEMBER_DAYS', 30, { min: 1, max: 365 }, errors),
    },
    bcryptRounds: toInt(source, 'BCRYPT_ROUNDS', 12, { min: 10, max: 15 }, errors),
    cookieSecure: toBool(source, 'COOKIE_SECURE', nodeEnv === 'production', errors),
    clientUrls,
    timezone: source.APP_TIMEZONE || 'Asia/Manila',
    // Shared secret Vercel Cron sends as "Authorization: Bearer <CRON_SECRET>" to /api/internal/sweep.
    cronSecret: source.CRON_SECRET?.trim() || null,
    // Failed-login limit per client IP per 15 minutes (0 disables it; per-account limits still apply).
    loginIpRateLimit: toInt(source, 'LOGIN_IP_RATE_LIMIT', 50, { min: 0, max: 10000 }, errors),
    // QR self-enrollment submissions per client IP per class link per 15 minutes (0 disables it).
    selfEnrollIpLimit: toInt(source, 'SELF_ENROLL_IP_LIMIT', 150, { min: 0, max: 10000 }, errors),
    // Audit-log retention in days (0 = keep forever). See services/auditRetention.service.js.
    auditRetention: Object.freeze({
      ipDays: toInt(source, 'AUDIT_IP_RETENTION_DAYS', 90, { min: 0, max: 36500 }, errors),
      routineDays: toInt(source, 'AUDIT_ROUTINE_RETENTION_DAYS', 365, { min: 0, max: 36500 }, errors),
      allDays: toInt(source, 'AUDIT_RETENTION_DAYS', 1825, { min: 0, max: 36500 }, errors),
    }),
  };

  if (config.isProduction && !config.cookieSecure) errors.push('COOKIE_SECURE must be true in production');
  if (config.cronSecret && config.cronSecret.length < 32) errors.push('CRON_SECRET must be at least 32 characters');
  // Behind a proxy/CDN (Vercel, Nginx) client IPs are only correct when this is set explicitly.
  if (config.isProduction && (source.TRUST_PROXY === undefined || source.TRUST_PROXY === '')) {
    errors.push('TRUST_PROXY must be set explicitly in production (Vercel: 1). See docs/DEPLOYMENT.md');
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
    error.name = 'ConfigError';
    throw error;
  }

  return Object.freeze(config);
}

export const env = loadConfig();
