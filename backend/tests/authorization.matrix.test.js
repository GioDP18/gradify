/**
 * Authorization matrix: every route × every role.
 *
 * ROUTES is the single table of what each route allows. The first test compares it with the
 * routes actually registered in src/routes/*.js, so a new route cannot be added without stating
 * who may call it. The rest checks each role, and that one instructor can never reach another
 * instructor's records through any :id route.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/models/User.js';
import { Class } from '../src/models/Class.js';
import { Student } from '../src/models/Student.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { GradingConfiguration } from '../src/models/GradingConfiguration.js';
import { useTestDatabase } from './helpers/db.js';
import { adminSession, createUser, instructorSession, loginAs, validClass, validStudent } from './helpers/factories.js';

useTestDatabase();
const app = createApp();
const RANDOM_ID = '64b0c0ffee0000000000abcd';

/* ───────── Who may call what ─────────
 * access: 'instructor' | 'admin' | 'staff' (instructor or admin) | 'any' (any signed-in user)
 *         | 'public' (no sign-in) | 'cron' (shared secret, never a user token)
 */
const ASSESSMENTS = ['quizzes', 'activities', 'examinations'];
const r = (access, method, route) => ({ access, method, route });
const ROUTES = [
  r('public', 'get', '/api/health'),
  r('public', 'post', '/api/auth/login'), r('public', 'post', '/api/auth/refresh'), r('public', 'post', '/api/auth/logout'),
  r('public', 'get', '/api/public/enroll/:token'), r('public', 'post', '/api/public/enroll/:token'),
  r('public', 'get', '/api/public/grades/:token'),
  r('cron', 'get', '/api/internal/sweep'),

  r('any', 'get', '/api/auth/me'), r('any', 'patch', '/api/auth/me'), r('any', 'patch', '/api/auth/me/preferences'),
  r('any', 'get', '/api/auth/me/avatar'), r('any', 'put', '/api/auth/me/avatar'), r('any', 'delete', '/api/auth/me/avatar'),
  r('any', 'put', '/api/auth/me/password'),

  r('admin', 'get', '/api/admin/users'), r('admin', 'post', '/api/admin/users'),
  r('admin', 'put', '/api/admin/users/:id/status'), r('admin', 'put', '/api/admin/users/:id/password'),

  r('staff', 'get', '/api/grading/configuration'), r('staff', 'get', '/api/grading/configuration/versions'),
  r('admin', 'post', '/api/grading/configuration'),

  r('instructor', 'get', '/api/classes'), r('instructor', 'post', '/api/classes'),
  r('instructor', 'get', '/api/classes/:id'), r('instructor', 'put', '/api/classes/:id'), r('instructor', 'delete', '/api/classes/:id'),
  r('instructor', 'post', '/api/classes/:id/restore'),
  r('instructor', 'put', '/api/classes/:id/self-enrollment'), r('instructor', 'post', '/api/classes/:id/self-enrollment/link'),
  r('instructor', 'get', '/api/classes/:id/enrollments'), r('instructor', 'post', '/api/classes/:id/enrollments'),
  r('instructor', 'put', '/api/classes/:id/enrollments/:studentId'), r('instructor', 'delete', '/api/classes/:id/enrollments/:studentId'),

  r('instructor', 'get', '/api/students'), r('instructor', 'get', '/api/students/facets'), r('instructor', 'get', '/api/students/export'),
  r('instructor', 'post', '/api/students/import'), r('instructor', 'post', '/api/students'),
  r('instructor', 'get', '/api/students/:id'), r('instructor', 'put', '/api/students/:id'), r('instructor', 'delete', '/api/students/:id'),
  r('instructor', 'post', '/api/students/:id/restore'),

  r('instructor', 'get', '/api/attendance'), r('instructor', 'get', '/api/attendance/summary'), r('instructor', 'post', '/api/attendance/sessions'),
  r('instructor', 'put', '/api/attendance/sessions/:id'), r('instructor', 'delete', '/api/attendance/sessions/:id'),
  r('instructor', 'get', '/api/attendance/sessions/:id/records'), r('instructor', 'put', '/api/attendance/sessions/:id/records'),
  r('instructor', 'get', '/api/attendance/:id'),

  ...ASSESSMENTS.flatMap((m) => [
    r('instructor', 'get', `/api/${m}`), r('instructor', 'post', `/api/${m}`),
    r('instructor', 'get', `/api/${m}/:id`), r('instructor', 'put', `/api/${m}/:id`), r('instructor', 'delete', `/api/${m}/:id`),
    r('instructor', 'get', `/api/${m}/:id/scores`), r('instructor', 'put', `/api/${m}/:id/scores`),
  ]),

  r('instructor', 'post', '/api/grading/share/bulk'), r('instructor', 'post', '/api/grading/share/bulk/stop'),
  r('instructor', 'get', '/api/grading/share/:studentId'), r('instructor', 'put', '/api/grading/share/:studentId'),
  r('instructor', 'delete', '/api/grading/share/:studentId'), r('instructor', 'post', '/api/grading/share/:studentId/email'),
  r('instructor', 'post', '/api/grading/recalculate'), r('instructor', 'get', '/api/grading/student/:studentId'),
  r('instructor', 'get', '/api/grading/:period'), r('instructor', 'get', '/api/grading/:period/summary'),
  r('instructor', 'get', '/api/grading/:period/export'),
  r('instructor', 'get', '/api/grading/:period/student/:studentId'), r('instructor', 'get', '/api/grading/:period/student/:studentId/export'),

  r('instructor', 'get', '/api/dashboard/overview'), r('instructor', 'get', '/api/dashboard/attendance'),
  r('instructor', 'get', '/api/dashboard/performance'), r('instructor', 'get', '/api/dashboard/activity'),
];

const key = ({ method, route }) => `${method.toUpperCase()} ${route}`;
/** A concrete URL for a route pattern (random, well-formed IDs). */
const urlFor = (route, ids = {}) =>
  route.replace(/:(\w+)/g, (_, name) => ids[name] ?? (name === 'period' ? 'midterm' : name === 'token' ? 'AbCdEfGhIjKlMnOpQrStUvWx' : RANDOM_ID));

/* ───────── The table covers every registered route ───────── */
const MOUNTS = {
  'health.routes.js': ['/api/health'], 'auth.routes.js': ['/api/auth'], 'internal.routes.js': ['/api/internal'],
  'public.routes.js': ['/api/public'], 'admin.routes.js': ['/api/admin'], 'gradingConfig.routes.js': ['/api/grading/configuration'],
  'class.routes.js': ['/api/classes'], 'student.routes.js': ['/api/students'], 'attendance.routes.js': ['/api/attendance'],
  'assessment.routes.js': ASSESSMENTS.map((m) => `/api/${m}`), 'grading.routes.js': ['/api/grading'], 'dashboard.routes.js': ['/api/dashboard'],
};

function registeredRoutes() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/routes');
  const found = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.routes.js'))) {
    const mounts = MOUNTS[file];
    if (!mounts) throw new Error(`tests/authorization.matrix.test.js: add ${file} to MOUNTS and its routes to ROUTES`);
    const source = readFileSync(path.join(dir, file), 'utf8');
    for (const [, method, routePath] of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      for (const mount of mounts) found.push(`${method.toUpperCase()} ${mount}${routePath === '/' ? '' : routePath}`);
    }
  }
  return found.sort();
}

describe('authorization matrix: coverage', () => {
  it('lists every route registered in src/routes (add new routes to ROUTES)', () => {
    const listed = ROUTES.map(key).sort();
    expect(new Set(listed).size).toBe(listed.length); // no duplicates
    expect(listed).toEqual(registeredRoutes());
  });
});

/* ───────── Every route × every role ───────── */
const needsLogin = ROUTES.filter((x) => !['public', 'cron'].includes(x.access));
const only = (...access) => ROUTES.filter((x) => access.includes(x.access));
const cases = (list) => list.map((x) => [x.method, x.route]);
const call = (method, route, token) => {
  const req = request(app)[method](urlFor(route));
  return (token ? req.set('Authorization', `Bearer ${token}`) : req).send({});
};

describe('authorization matrix: roles', () => {
  let tokens;
  // The database is wiped after every test, so the accounts are recreated each time.
  beforeEach(async () => {
    const make = async (role) => (await loginAs(app, await createUser({ role }))).accessToken;
    tokens = { student: await make(ROLES.STUDENT), instructor: await make(ROLES.INSTRUCTOR), admin: await make(ROLES.ADMIN) };
  });

  it.each(cases(needsLogin))('anonymous: %s %s → 401', async (method, route) => {
    const res = await call(method, route);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it.each(cases(only('instructor', 'admin', 'staff')))('student: %s %s → 403', async (method, route) => {
    const res = await call(method, route, tokens.student);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(cases(only('admin')))('instructor: %s %s (administrator only) → 403', async (method, route) => {
    const res = await call(method, route, tokens.instructor);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(cases(only('instructor')))('administrator: %s %s (instructor only) → 403', async (method, route) => {
    const res = await call(method, route, tokens.admin);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(cases(only('instructor', 'staff')))('instructor: %s %s is not refused for its role', async (method, route) => {
    expect([401, 403]).not.toContain((await call(method, route, tokens.instructor)).status);
  });

  it.each(cases(only('admin', 'staff')))('administrator: %s %s is not refused for its role', async (method, route) => {
    expect([401, 403]).not.toContain((await call(method, route, tokens.admin)).status);
  });

  it.each(cases(only('any')))('any signed-in user (student): %s %s is not refused for its role', async (method, route) => {
    expect([401, 403]).not.toContain((await call(method, route, tokens.student)).status);
  });

  it('a non-admin cannot publish grading criteria, even with a valid change', async () => {
    const change = { periodWeights: { MIDTERM: 50, FINALS: 50 }, notes: 'not allowed' };
    for (const token of [tokens.instructor, tokens.student]) {
      const res = await request(app).post('/api/grading/configuration').set('Authorization', `Bearer ${token}`).send(change);
      expect(res.status).toBe(403);
    }
    expect((await request(app).post('/api/grading/configuration').send(change)).status).toBe(401);
    expect(await GradingConfiguration.countDocuments({ version: { $gt: 1 } })).toBe(0);
  });

  it('the cron endpoint accepts only its secret, never a user token', async () => {
    expect((await request(app).get('/api/internal/sweep')).status).toBe(401);
    for (const token of Object.values(tokens)) {
      expect((await request(app).get('/api/internal/sweep').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    }
    expect((await request(app).get('/api/internal/sweep').set('Authorization', `Bearer ${process.env.CRON_SECRET}`)).status).toBe(200);
  });

  it('never leaks stack traces or internals in error responses', async () => {
    const res = await request(app).get('/api/students/not-an-id').set('Authorization', `Bearer ${tokens.student}`);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|at .*\.js/);
  });
});

/* ───────── One instructor can never reach another instructor's records ───────── */
describe('authorization matrix: cross-instructor isolation', () => {
  it('every route that takes a record ID answers 404 for another instructor\'s IDs, and changes nothing', async () => {
    const owner = await instructorSession(app);
    const intruder = await instructorSession(app);

    // The owner's records.
    const cls = (await owner.post('/api/classes', validClass())).body.data;
    const student = (await owner.post(`/api/students?classId=${cls.id}`, validStudent())).body.data;
    const session = (await owner.post('/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-01' })).body.data;
    const items = {};
    for (const m of ASSESSMENTS) {
      items[m] = (await owner.post(`/api/${m}`, { classId: cls.id, title: `${m} 1`, period: 'MIDTERM', date: '2026-09-10', maxScore: 100 })).body.data;
    }
    const ids = { id: cls.id, studentId: student.id };
    const c = `classId=${cls.id}`;
    const newItem = { classId: cls.id, title: 'Intruder item', period: 'MIDTERM', date: '2026-09-11', maxScore: 10 };

    // [method, url, body] — each with a body valid enough to reach the ownership check.
    const attempts = [
      ['get', `/api/classes/${cls.id}`], ['put', `/api/classes/${cls.id}`, { subjectTitle: 'Taken over' }], ['delete', `/api/classes/${cls.id}`],
      ['post', `/api/classes/${cls.id}/restore`],
      ['put', `/api/classes/${cls.id}/self-enrollment`, { open: true }], ['post', `/api/classes/${cls.id}/self-enrollment/link`],
      ['get', `/api/classes/${cls.id}/enrollments`], ['post', `/api/classes/${cls.id}/enrollments`, { studentIds: [student.id] }],
      ['put', urlFor('/api/classes/:id/enrollments/:studentId', ids), { status: 'DROPPED', reason: 'intruder' }],
      ['delete', urlFor('/api/classes/:id/enrollments/:studentId', ids)],

      ['post', `/api/students?${c}`, validStudent()],
      ['get', `/api/students/${student.id}`], ['put', `/api/students/${student.id}`, validStudent({ lastName: 'Changed' })],
      ['delete', `/api/students/${student.id}`], ['post', `/api/students/${student.id}/restore`],

      ['get', `/api/attendance?${c}`], ['get', `/api/attendance/summary?${c}`],
      ['post', '/api/attendance/sessions', { classId: cls.id, period: 'MIDTERM', sessionDate: '2026-09-02' }],
      ['get', `/api/attendance/${session.id}`], ['put', `/api/attendance/sessions/${session.id}`, { description: 'intruder' }],
      ['delete', `/api/attendance/sessions/${session.id}`],
      ['get', `/api/attendance/sessions/${session.id}/records`],
      ['put', `/api/attendance/sessions/${session.id}/records`, { revision: 0, records: [{ studentId: student.id, status: 'ABSENT' }] }],

      ...ASSESSMENTS.flatMap((m) => [
        ['get', `/api/${m}?${c}`], ['post', `/api/${m}`, newItem],
        ['get', `/api/${m}/${items[m].id}`], ['put', `/api/${m}/${items[m].id}`, { title: 'Changed' }], ['delete', `/api/${m}/${items[m].id}`],
        ['get', `/api/${m}/${items[m].id}/scores`],
        ['put', `/api/${m}/${items[m].id}/scores`, { revision: 0, scores: [{ studentId: student.id, score: 1 }] }],
      ]),

      ['post', '/api/grading/recalculate', { classId: cls.id }],
      ...['midterm', 'finals', 'overall'].flatMap((p) => [
        ['get', `/api/grading/${p}?${c}`], ['get', `/api/grading/${p}/summary?${c}`], ['get', `/api/grading/${p}/export?${c}`],
        ['get', `/api/grading/${p}/student/${student.id}?${c}`], ['get', `/api/grading/${p}/student/${student.id}/export?${c}`],
      ]),

      ['get', `/api/dashboard/overview?${c}`], ['get', `/api/dashboard/attendance?${c}`],
      ['get', `/api/dashboard/performance?${c}`], ['get', `/api/dashboard/activity?${c}`],
    ];

    const wrong = [];
    for (const [method, url, body] of attempts) {
      const res = await request(app)[method](url).set(intruder.headers).send(body ?? {});
      if (res.status !== 404) wrong.push(`${method.toUpperCase()} ${url} → ${res.status} ${JSON.stringify(res.body.error?.message ?? '')}`);
    }
    expect(wrong).toEqual([]);

    // Listing endpoints without an ID show the intruder only their own (empty) data.
    expect((await intruder.get('/api/classes')).body.data).toEqual([]);
    expect((await intruder.get('/api/students')).body.data).toEqual([]);
    const grades = await intruder.get(`/api/grading/student/${student.id}`);
    expect(grades.status === 404 || (grades.status === 200 && JSON.stringify(grades.body.data).includes(student.id) === false)).toBe(true);

    // Nothing the owner has was changed.
    const after = await Class.findById(cls.id).lean();
    expect(after).toMatchObject({ subjectTitle: cls.subjectTitle, status: 'ACTIVE' });
    expect(after.selfEnrollment?.open ?? false).toBe(false);
    expect((await Student.findById(student.id).lean()).lastName).toBe(student.lastName);
    expect(await Enrollment.countDocuments({ class: cls.id, status: 'ENROLLED' })).toBe(1);
    expect((await owner.get(`/api/attendance?${c}`)).body.data).toHaveLength(1);
    for (const m of ASSESSMENTS) expect((await owner.get(`/api/${m}?${c}`)).body.data.map((i) => i.title)).toEqual([`${m} 1`]);
  });

  it('the administrator cannot manage another administrator through the accounts API', async () => {
    const admin = await adminSession(app);
    const other = await adminSession(app);
    expect((await admin.put(`/api/admin/users/${other.user.id}/status`, { status: 'DISABLED' })).status).toBe(404);
    expect((await admin.put(`/api/admin/users/${other.user.id}/password`, { password: 'Another-Passw0rd!' })).status).toBe(404);
  });
});
