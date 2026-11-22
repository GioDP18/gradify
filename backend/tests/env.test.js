import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  CLIENT_URL: 'http://localhost:5173, https://grades.example.edu/',
};

describe('loadConfig', () => {
  it('builds a frozen config with defaults', () => {
    const config = loadConfig(valid);
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.port).toBe(5000);
    expect(config.mongodb.dbName).toBe('evsu_grading_system');
    expect(config.clientUrls).toEqual(['http://localhost:5173', 'https://grades.example.edu']);
    expect(config.timezone).toBe('Asia/Manila');
  });

  it('lists every problem at once', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrowError(
      /NODE_ENV must be one of[\s\S]*MONGODB_URI is required[\s\S]*JWT_ACCESS_SECRET is required/,
    );
  });

  it('rejects short or identical JWT secrets', () => {
    expect(() => loadConfig({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrowError(/at least 32 characters/);
    expect(() => loadConfig({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET })).toThrowError(/must be different/);
  });

  it('requires secure cookies in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrowError(
      /COOKIE_SECURE must be true/,
    );
    expect(loadConfig({ ...valid, NODE_ENV: 'production', TRUST_PROXY: '1' }).cookieSecure).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(() => loadConfig({ ...valid, PORT: 'abc' })).toThrowError(/PORT must be an integer/);
    expect(() => loadConfig({ ...valid, MONGODB_URI: 'http://x' })).toThrowError(/must start with mongodb/);
    expect(() => loadConfig({ ...valid, CLIENT_URL: 'localhost:5173' })).toThrowError(/must be an origin/);
    expect(() => loadConfig({ ...valid, DNS_SERVERS: '8.8.8.8, dns.google' })).toThrowError(/must be an IP address/);
  });

  it('parses optional DNS servers', () => {
    expect(loadConfig(valid).mongodb.dnsServers).toEqual([]);
    expect(loadConfig({ ...valid, DNS_SERVERS: '8.8.8.8, 1.1.1.1' }).mongodb.dnsServers).toEqual(['8.8.8.8', '1.1.1.1']);
  });
});
