import request from 'supertest';
import { User, ROLES } from '../../src/models/User.js';
import { hashPassword } from '../../src/utils/password.js';

export const DEFAULT_PASSWORD = 'Correct-Horse-9-Battery';

let counter = 0;

export async function createUser(overrides = {}) {
  counter += 1;
  const { password = DEFAULT_PASSWORD, ...rest } = overrides;
  return User.create({
    name: `Test User ${counter}`,
    email: `user${counter}@evsu.test`,
    role: ROLES.INSTRUCTOR,
    passwordHash: await hashPassword(password),
    ...rest,
  });
}

/** Logs in through the real API; returns the access token and the refresh cookie. */
export async function loginAs(app, user, { password = DEFAULT_PASSWORD, remember = false } = {}) {
  const res = await request(app).post('/api/auth/login').send({ identifier: user.email, password, remember });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.data.accessToken, cookie: res.headers['set-cookie'][0].split(';')[0], res };
}

let studentCounter = 0;
export const validStudent = (overrides = {}) => {
  studentCounter += 1;
  return {
    studentNumber: `2026-${String(10000 + studentCounter)}`,
    firstName: 'Juan',
    middleName: 'Protacio',
    lastName: 'Dela Cruz',
    email: null,
    course: 'BSIT',
    yearLevel: 1,
    section: 'A',
    ...overrides,
  };
};

/** Logs in a fresh administrator (manages instructors and the shared criteria). */
export async function adminSession(app) {
  return instructorSession(app, { role: ROLES.ADMIN });
}

/** Logs in a fresh instructor and returns helpers bound to their token. */
export async function instructorSession(app, overrides = {}) {
  const user = await createUser(overrides);
  const { accessToken } = await loginAs(app, user);
  const headers = { Authorization: `Bearer ${accessToken}` };
  return {
    user,
    headers,
    get: (url) => request(app).get(url).set(headers),
    post: (url, body) => request(app).post(url).set(headers).send(body),
    put: (url, body) => request(app).put(url).set(headers).send(body),
    del: (url) => request(app).delete(url).set(headers),
  };
}

export const validClass = (overrides = {}) => ({
  subjectCode: 'IT 101',
  subjectTitle: 'Introduction to Computing',
  section: 'BSIT-1A',
  schoolYear: '2026-2027',
  semester: 'FIRST',
  termEndDate: '2026-12-18',
  ...overrides,
});
