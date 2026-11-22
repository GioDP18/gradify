/**
 * I-2: access logs never contain the QR enrollment token or query strings (search terms).
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { redactUrl, createRequestLogger } from '../src/middleware/requestLogger.js';

const TOKEN = 'culqwsxqribxfptK8RN09XCd';

describe('redactUrl', () => {
  it('hides the enrollment token in API paths and in the web page address', () => {
    expect(redactUrl(`/api/public/enroll/${TOKEN}`)).toBe('/api/public/enroll/[redacted]');
    expect(redactUrl(`https://grades.example.edu/join/${TOKEN}`)).toBe('https://grades.example.edu/join/[redacted]');
  });

  it('drops query strings and fragments', () => {
    expect(redactUrl('/api/students?search=dela+cruz&page=2')).toBe('/api/students');
    expect(redactUrl(`/api/public/enroll/${TOKEN}?x=1#top`)).toBe('/api/public/enroll/[redacted]');
  });

  it('leaves other paths, and non-strings, alone', () => {
    expect(redactUrl('/api/classes/64b0c0ffee0000000000abcd/enrollments')).toBe('/api/classes/64b0c0ffee0000000000abcd/enrollments');
    expect(redactUrl(undefined)).toBeUndefined();
    expect(redactUrl('')).toBe('');
  });
});

describe('access log lines', () => {
  async function logLineFor(format, path, headers = {}) {
    const lines = [];
    const app = express();
    app.use(createRequestLogger({ format, stream: { write: (line) => lines.push(line) } }));
    app.use((req, res) => res.json({ ok: true }));
    let req = request(app).get(path);
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    await req;
    return lines.join('');
  }

  it.each(['combined', 'dev'])('%s format: no token, no search terms, no token in the referrer', async (format) => {
    const enroll = await logLineFor(format, `/api/public/enroll/${TOKEN}?utm=1`, { Referer: `https://grades.example.edu/join/${TOKEN}?from=qr` });
    expect(enroll).toContain('/api/public/enroll/[redacted]');
    expect(enroll).not.toContain(TOKEN);
    expect(enroll).not.toContain('utm=1');
    expect(enroll).not.toContain('from=qr');

    const search = await logLineFor(format, '/api/students?search=Dela%20Cruz&scope=class');
    expect(search).toContain('GET /api/students ');
    expect(search).not.toMatch(/Dela|search=|scope=/);
  });

  it('combined format keeps the redacted referrer', async () => {
    const line = await logLineFor('combined', '/api/health', { Referer: `https://grades.example.edu/join/${TOKEN}` });
    expect(line).toContain('"https://grades.example.edu/join/[redacted]"');
  });
});
