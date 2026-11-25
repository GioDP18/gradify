import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { setMailTransportForTests } from '../src/services/mail.service.js';
import { loadConfig } from '../src/config/env.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession, validClass, validStudent } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

let me;
let cls;
let ana;
let sent;
const shareUrl = (student = ana) => `/api/grading/share/${student.id}`;
const view = (token) => request(app).get(`/api/public/grades/${token}`);
const share = async (durationHours = null, scope) => (await me.put(shareUrl(), { classId: cls.id, durationHours, scope })).body.data.share;

beforeEach(async () => {
  me = await instructorSession(app);
  cls = (await me.post('/api/classes', validClass())).body.data;
  ana = (await me.post('/api/students', validStudent({ firstName: 'Ana', lastName: 'Bautista', email: 'ana@evsu.edu.ph' }))).body.data;
  await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [ana.id] });
  sent = [];
  setMailTransportForTests({ sendMail: async (message) => { sent.push(message); } });
});
afterEach(() => setMailTransportForTests(null));

describe('sharing a grading sheet with the student', () => {
  it('is off until the instructor shares it; then the link shows only that student', async () => {
    const before = (await me.get(`${shareUrl()}?classId=${cls.id}`)).body.data;
    expect(before).toEqual({ share: null, student: { fullName: 'Bautista, Ana P.', email: 'ana@evsu.edu.ph' }, emailAvailable: true });

    const shared = await share();
    expect(shared.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(shared).toMatchObject({ scope: 'all', expiresAt: null, expired: false, emailedAt: null });

    const res = await view(shared.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.student).toEqual({ studentNumber: ana.studentNumber, fullName: 'Bautista, Ana P.', course: 'BSIT', yearLevel: 1, section: 'A' });
    expect(res.body.data.class).toMatchObject({ subjectCode: 'IT 101', section: 'BSIT-1A' });
    expect(res.body.data.instructor).toBe(me.user.name);
    expect(Object.keys(res.body.data.grades)).toEqual(['midterm', 'finals', 'overall']);
    expect(res.body.data.grades.midterm.components.map((c) => c.key)).toContain('ATTENDANCE');
    expect(res.body.data.grades.overall.periods.FINALS.period).toBe('FINALS');
    expect(JSON.stringify(res.body.data)).not.toContain(ana.id); // no internal ids
    expect(await AuditLog.countDocuments({ action: 'GRADE_SHARE_SET' })).toBe(1);
  });

  it('a time limit ends the viewing; a new limit reopens the same link', async () => {
    const shared = await share(24);
    expect(new Date(shared.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    await Enrollment.updateOne({ 'gradeShare.token': shared.token }, { 'gradeShare.expiresAt': new Date(Date.now() - 1000) });

    const expired = await view(shared.token);
    expect(expired.status).toBe(410);
    expect(expired.body.error.message).toMatch(/expired/i);
    expect((await me.get(`${shareUrl()}?classId=${cls.id}`)).body.data.share.expired).toBe(true);

    const again = await share(72);
    expect(again.token).toBe(shared.token);
    expect((await view(shared.token)).status).toBe(200);
  });

  it('can share only one period; the rest never leaves the server', async () => {
    const shared = await share(null, 'midterm');
    expect(shared.scope).toBe('midterm');
    const res = await view(shared.token);
    expect(res.body.data.scope).toBe('midterm');
    expect(Object.keys(res.body.data.grades)).toEqual(['midterm']);

    // Changing the time limit alone keeps what is shared; the Final Grade carries its two periods.
    expect((await share(24)).scope).toBe('midterm');
    const overall = await share(null, 'overall');
    expect(overall.token).toBe(shared.token);
    const final = (await view(shared.token)).body.data.grades;
    expect(Object.keys(final)).toEqual(['overall']);
    expect(Object.keys(final.overall.periods)).toEqual(['MIDTERM', 'FINALS']);

    expect((await me.put(shareUrl(), { classId: cls.id, scope: 'prelim' })).status).toBe(422);
    await share(null, 'finals');
    await me.post(`${shareUrl()}/email`, { classId: cls.id });
    expect(sent[0].text).toContain('It shows your Finals grade');
  });

  it('stopping makes the link stop working, and sharing again gives a different link', async () => {
    const first = await share();
    const stopped = await me.del(`${shareUrl()}?classId=${cls.id}`);
    expect(stopped.body.data.share).toBeNull();
    expect((await view(first.token)).status).toBe(404);
    const second = await share();
    expect(second.token).not.toBe(first.token);
  });

  it('refuses unknown links, bad durations, other instructors, and students outside the class', async () => {
    expect((await view('A'.repeat(24))).status).toBe(404);
    expect((await me.put(shareUrl(), { classId: cls.id, durationHours: 0 })).status).toBe(422);
    expect((await me.put(shareUrl(), { classId: cls.id, durationHours: 'soon' })).status).toBe(422);

    const outsider = (await me.post('/api/students', validStudent())).body.data;
    expect((await me.put(shareUrl(outsider), { classId: cls.id })).status).toBe(404);

    const other = await instructorSession(app);
    expect((await other.put(shareUrl(), { classId: cls.id })).status).toBe(404);
    expect((await request(app).put(shareUrl()).send({ classId: cls.id })).status).toBe(401);
  });

  it('removing the student from the class removes the link', async () => {
    const shared = await share();
    await me.del(`/api/classes/${cls.id}/enrollments/${ana.id}`);
    expect((await view(shared.token)).status).toBe(404);
  });
});

describe('emailing the link', () => {
  it('sends it to the address on the student record, with the time limit', async () => {
    const shared = await share(24);
    const res = await me.post(`${shareUrl()}/email`, { classId: cls.id });
    expect(res.status).toBe(200);
    expect(res.body.data.share.emailedAt).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ana@evsu.edu.ph');
    expect(sent[0].replyTo).toBe(me.user.email);
    expect(sent[0].subject).toBe('Your grading sheet for IT 101 · BSIT-1A');
    expect(sent[0].text).toContain(`http://localhost:5173/my-grades/${shared.token}`);
    expect(sent[0].text).toMatch(/works until/);
    expect(sent[0].html).toContain(`/my-grades/${shared.token}`);
    expect(await AuditLog.countDocuments({ action: 'GRADE_SHARE_EMAIL' })).toBe(1);
  });

  it('needs an active share and an email address', async () => {
    expect((await me.post(`${shareUrl()}/email`, { classId: cls.id })).status).toBe(409);
    const shared = await share(1);
    await Enrollment.updateOne({ 'gradeShare.token': shared.token }, { 'gradeShare.expiresAt': new Date(Date.now() - 1000) });
    expect((await me.post(`${shareUrl()}/email`, { classId: cls.id })).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it('gives plain messages when email is not set up or the mail server fails', async () => {
    await share();
    setMailTransportForTests({ sendMail: async () => { throw new Error('ECONNREFUSED 10.0.0.1:587'); } });
    const failed = await me.post(`${shareUrl()}/email`, { classId: cls.id });
    expect(failed.status).toBe(502);
    expect(failed.body.error.message).not.toMatch(/ECONNREFUSED/);
    expect(failed.body.error.message).toMatch(/copy the link/i);

    setMailTransportForTests(null);
    const off = await me.post(`${shareUrl()}/email`, { classId: cls.id });
    expect(off.status).toBe(503);
    expect((await me.get(`${shareUrl()}?classId=${cls.id}`)).body.data.emailAvailable).toBe(false);
  });
});

describe('sharing with several students at once', () => {
  let ben;
  let carla;
  beforeEach(async () => {
    ben = (await me.post('/api/students', validStudent({ firstName: 'Ben', lastName: 'Cruz', email: 'ben@evsu.edu.ph' }))).body.data;
    carla = (await me.post('/api/students', validStudent({ firstName: 'Carla', lastName: 'Dizon', email: 'carla@evsu.edu.ph' }))).body.data;
    await me.post(`/api/classes/${cls.id}/enrollments`, { studentIds: [ben.id, carla.id] });
  });
  const stateOf = async (student) => (await me.get(`${shareUrl(student)}?classId=${cls.id}`)).body.data.share;

  it('gives each selected student their own link with the same choices, and emails them', async () => {
    const mine = await share(); // Ana already has a link: it is kept
    sent = [];
    const res = await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [ana.id, ben.id], durationHours: 24, scope: 'midterm', email: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ shared: 2, emailRequested: true, emailAvailable: true, emailed: 2, noEmail: [], emailFailed: [] });

    const [a, b] = [await stateOf(ana), await stateOf(ben)];
    expect(a.token).toBe(mine.token);
    expect(b.token).not.toBe(a.token);
    expect(a).toMatchObject({ scope: 'midterm', expired: false });
    expect(b.emailedAt).not.toBeNull();
    expect(await stateOf(carla)).toBeNull(); // not selected
    expect(sent.map((m) => m.to).sort()).toEqual(['ana@evsu.edu.ph', 'ben@evsu.edu.ph']);
    expect(sent.find((m) => m.to === 'ben@evsu.edu.ph').text).toContain(`/my-grades/${b.token}`);
    expect(Object.keys((await view(b.token)).body.data.grades)).toEqual(['midterm']);
    expect(await AuditLog.countDocuments({ action: 'GRADE_SHARE_SET_BULK' })).toBe(1);
  });

  it('reports by name who could not be emailed, and still shares with them', async () => {
    setMailTransportForTests({ sendMail: async (message) => { if (message.to === 'ben@evsu.edu.ph') throw new Error('mailbox full'); sent.push(message); } });
    const res = await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [ana.id, ben.id, carla.id], email: true });
    expect(res.body.data).toMatchObject({ shared: 3, emailed: 2, emailFailed: ['Cruz, Ben P.'] });
    expect((await stateOf(ben)).emailedAt).toBeNull();

    setMailTransportForTests(null);
    const off = await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [ana.id], email: true });
    expect(off.body.data).toMatchObject({ shared: 1, emailAvailable: false, emailed: 0 });
  });

  it('stops sharing for the selected students only', async () => {
    await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [ana.id, ben.id, carla.id] });
    const token = (await stateOf(ana)).token;
    const res = await me.post('/api/grading/share/bulk/stop', { classId: cls.id, studentIds: [ana.id, ben.id] });
    expect(res.body.data).toEqual({ stopped: 2 });
    expect((await view(token)).status).toBe(404);
    expect(await stateOf(carla)).not.toBeNull();
    // The class sheet says who has a link, so the page can offer "stop" only where it applies.
    const rows = (await me.get(`/api/grading/midterm?classId=${cls.id}`)).body.data.rows;
    expect(Object.fromEntries(rows.map((r) => [r.fullName.split(',')[0], r.shared]))).toEqual({ Bautista: false, Cruz: false, Dizon: true });
  });

  it('ignores students outside the class and refuses other instructors and empty selections', async () => {
    const outsider = (await me.post('/api/students', validStudent())).body.data;
    expect((await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [ana.id, outsider.id] })).body.data.shared).toBe(1);
    expect((await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [outsider.id] })).status).toBe(404);
    expect((await me.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [] })).status).toBe(422);
    const other = await instructorSession(app);
    expect((await other.post('/api/grading/share/bulk', { classId: cls.id, studentIds: [ana.id] })).status).toBe(404);
    expect((await other.post('/api/grading/share/bulk/stop', { classId: cls.id, studentIds: [ana.id] })).status).toBe(404);
  });
});

describe('email settings', () => {
  const base = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) };
  it('is off without SMTP_HOST and reads a complete setup', () => {
    expect(loadConfig(base).mail).toBeNull();
    expect(loadConfig({ ...base, SMTP_HOST: 'smtp.example.edu', SMTP_PORT: '465', SMTP_USER: 'grades@example.edu', SMTP_PASS: 'x' }).mail)
      .toEqual({ host: 'smtp.example.edu', port: 465, secure: true, user: 'grades@example.edu', pass: 'x', from: 'Gradify <grades@example.edu>' });
  });
  it('refuses a half-finished setup', () => {
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.edu' })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ ...base, SMTP_HOST: 'smtp.example.edu', SMTP_USER: 'grades@example.edu' })).toThrow(/SMTP_PASS/);
  });
});
