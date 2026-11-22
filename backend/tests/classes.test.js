import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser, loginAs, validClass } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let auth;
let otherAuth;

beforeEach(async () => {
  const instructor = await createUser();
  const other = await createUser();
  auth = { Authorization: `Bearer ${(await loginAs(app, instructor)).accessToken}` };
  otherAuth = { Authorization: `Bearer ${(await loginAs(app, other)).accessToken}` };
});

const create = (body = validClass(), headers = auth) => request(app).post('/api/classes').set(headers).send(body);

describe('classes API', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/classes')).status).toBe(401);
  });

  it('creates a class with normalized fields and audits it', async () => {
    const res = await create(validClass({ subjectCode: 'it 101', section: 'bsit-1a' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ subjectCode: 'IT 101', section: 'BSIT-1A', status: 'ACTIVE', semester: 'FIRST' });
    expect(new Date(res.body.data.termEndDate).toISOString()).toBe('2026-12-18T00:00:00.000Z');
    expect(await AuditLog.countDocuments({ action: 'CLASS_CREATE' })).toBe(1);
  });

  it('validates every field', async () => {
    const res = await create({ subjectCode: '', schoolYear: '2026-2028', semester: 'THIRD', termEndDate: '18/12/2026' });
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['subjectCode', 'subjectTitle', 'section', 'schoolYear', 'semester', 'termEndDate']));
  });

  it('drops unknown fields such as instructor or status', async () => {
    const intruder = '64b000000000000000000000';
    const res = await create({ ...validClass(), instructor: intruder, status: 'ARCHIVED' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ACTIVE');
    const list = await request(app).get('/api/classes').set(auth);
    expect(list.body.data).toHaveLength(1);
  });

  it('prevents duplicate subject/section/term for the same instructor (but not across instructors)', async () => {
    await create();
    const dup = await create(validClass({ subjectCode: 'it 101' }));
    expect(dup.status).toBe(409);
    expect((await create(validClass(), otherAuth)).status).toBe(201);
  });

  it('only lists and returns the instructor’s own classes', async () => {
    const mine = await create();
    await create(validClass({ section: 'BSIT-1B' }), otherAuth);
    const list = await request(app).get('/api/classes').set(auth);
    expect(list.body.data.map((c) => c.id)).toEqual([mine.body.data.id]);

    const peek = await request(app).get(`/api/classes/${mine.body.data.id}`).set(otherAuth);
    expect(peek.status).toBe(404);
    const edit = await request(app).put(`/api/classes/${mine.body.data.id}`).set(otherAuth).send({ subjectTitle: 'Hacked' });
    expect(edit.status).toBe(404);
  });

  it('updates a class and records previous/new values', async () => {
    const { body } = await create();
    const res = await request(app).put(`/api/classes/${body.data.id}`).set(auth).send({ subjectTitle: 'Intro to Computing', termEndDate: '2026-12-20' });
    expect(res.status).toBe(200);
    expect(res.body.data.subjectTitle).toBe('Intro to Computing');
    const entry = await AuditLog.findOne({ action: 'CLASS_UPDATE' }).lean();
    expect(entry.previousValue.subjectTitle).toBe('Introduction to Computing');
    expect(entry.newValue.subjectTitle).toBe('Intro to Computing');
  });

  it('archives instead of deleting, blocks edits while archived, and restores', async () => {
    const { body } = await create();
    const id = body.data.id;
    const archived = await request(app).delete(`/api/classes/${id}`).set(auth);
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('ARCHIVED');

    expect((await request(app).put(`/api/classes/${id}`).set(auth).send({ subjectTitle: 'X' })).status).toBe(409);
    const activeOnly = await request(app).get('/api/classes?status=ACTIVE').set(auth);
    expect(activeOnly.body.data).toHaveLength(0);

    const restored = await request(app).post(`/api/classes/${id}/restore`).set(auth);
    expect(restored.body.data.status).toBe('ACTIVE');
  });

  it('returns 400-class errors for malformed IDs', async () => {
    const res = await request(app).get('/api/classes/not-an-id').set(auth);
    expect(res.status).toBe(422);
  });
});
