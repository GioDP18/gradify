import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession } from './helpers/factories.js';

useTestDatabase();
const app = createApp();

// Smallest valid headers for each format, padded to a realistic size.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(200, 3)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const upload = (me, buffer, filename = 'photo.png') => request(app).put('/api/auth/me/avatar').set(me.headers).attach('avatar', buffer, filename);

describe('profile photo', () => {
  it('stores a photo, reports when it changed, and serves it only to its owner', async () => {
    const me = await instructorSession(app);
    expect((await me.get('/api/auth/me/avatar')).status).toBe(404);

    const res = await upload(me, PNG);
    expect(res.status).toBe(200);
    expect(res.body.data.user.avatarUpdatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/"avatar":/); // the bytes are never in the user object

    const image = await me.get('/api/auth/me/avatar');
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('private, max-age=86400');
    expect(Buffer.compare(image.body, PNG)).toBe(0);
    expect((await request(app).get('/api/auth/me/avatar')).status).toBe(401);

    // Signing in again returns the timestamp but not the image.
    const meNow = (await me.get('/api/auth/me')).body.data.user;
    expect(meNow.avatarUpdatedAt).toBe(res.body.data.user.avatarUpdatedAt);
    expect(await AuditLog.countDocuments({ action: 'AUTH_AVATAR_UPDATE', user: me.user._id })).toBe(1);
  });

  it('accepts JPEG and WebP, identified by content rather than the file name', async () => {
    const me = await instructorSession(app);
    expect((await upload(me, JPEG, 'looks-like.png')).status).toBe(200);
    expect((await me.get('/api/auth/me/avatar')).headers['content-type']).toBe('image/jpeg');
    expect((await upload(me, WEBP, 'x.bin')).status).toBe(200);
    expect((await me.get('/api/auth/me/avatar')).headers['content-type']).toBe('image/webp');
  });

  it('refuses SVG, other files, and anything over 1 MB', async () => {
    const me = await instructorSession(app);
    const svg = await upload(me, SVG, 'avatar.svg');
    expect(svg.status).toBe(400);
    expect(svg.body.error.message).toBe('Use a JPEG, PNG, or WebP image.');
    expect((await upload(me, Buffer.from('not an image at all'), 'avatar.png')).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect((await upload(me, big)).status).toBe(413);
    expect((await User.findById(me.user._id)).avatarUpdatedAt).toBeUndefined();
  });

  it('removes the photo', async () => {
    const me = await instructorSession(app);
    await upload(me, PNG);
    const res = await me.del('/api/auth/me/avatar');
    expect(res.status).toBe(200);
    expect(res.body.data.user.avatarUpdatedAt).toBeNull();
    expect((await me.get('/api/auth/me/avatar')).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'AUTH_AVATAR_REMOVE', user: me.user._id })).toBe(1);
  });
});
