import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { useTestDatabase } from './helpers/db.js';
import { instructorSession } from './helpers/factories.js';
import { AssistantChat } from '../src/models/AssistantChat.js';

useTestDatabase();
const app = createApp();
const patch = (me, body) => request(app).patch('/api/auth/me/preferences').set(me.headers).send(body);

describe('PATCH /api/auth/me/preferences', () => {
  it('defaults to a shared working class and can turn it off and on', async () => {
    const me = await instructorSession(app);
    expect((await me.get('/api/auth/me')).body.data.user.preferences).toEqual({ workingClass: true, chatHistory: true });

    const off = await patch(me, { workingClass: false });
    expect(off.status).toBe(200);
    expect(off.body.data.user.preferences).toEqual({ workingClass: false, chatHistory: true });
    // Remembered for the next session (the user object comes back on every sign-in and refresh).
    expect((await me.get('/api/auth/me')).body.data.user.preferences.workingClass).toBe(false);

    expect((await patch(me, { workingClass: true })).body.data.user.preferences.workingClass).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'AUTH_PREFERENCES_UPDATE', user: me.user._id })).toBe(2);
  });

  it('keeps the assistant\'s chat history by default and can turn it off, without touching other settings', async () => {
    const me = await instructorSession(app);
    await patch(me, { workingClass: false });
    const off = await patch(me, { chatHistory: false });
    expect(off.status).toBe(200);
    expect(off.body.data.user.preferences).toEqual({ workingClass: false, chatHistory: false });
    expect((await me.get('/api/auth/me')).body.data.user.preferences.chatHistory).toBe(false);
    expect((await patch(me, { chatHistory: true })).body.data.user.preferences).toEqual({ workingClass: false, chatHistory: true });
    expect((await patch(me, { chatHistory: 'off' })).status).toBe(422);
  });

  it('keeps the saved chats when chat history is turned off and on again', async () => {
    const me = await instructorSession(app);
    const other = await instructorSession(app);
    const messages = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }];
    await AssistantChat.create([{ user: me.user._id, title: 'Hi', messages }, { user: me.user._id, title: 'Hi again', messages }, { user: other.user._id, title: 'Theirs', messages }]);

    await patch(me, { workingClass: false }); // another setting leaves the chats alone
    expect(await AssistantChat.countDocuments({ user: me.user._id })).toBe(2);
    await patch(me, { chatHistory: true });
    expect(await AssistantChat.countDocuments({ user: me.user._id })).toBe(2);

    await patch(me, { chatHistory: false });
    expect(await AssistantChat.countDocuments({ user: me.user._id })).toBe(2);
    await patch(me, { chatHistory: true });
    await patch(me, { chatHistory: false });
    await patch(me, { chatHistory: true });
    expect((await me.get('/api/assistant/chats')).body.data.map((c) => c.title).sort()).toEqual(['Hi', 'Hi again']);
    expect(await AssistantChat.countDocuments({ user: other.user._id })).toBe(1);
  });

  it('accepts only true or false, and needs a signed-in user', async () => {
    const me = await instructorSession(app);
    expect((await patch(me, { workingClass: 'no' })).status).toBe(422);
    expect((await request(app).patch('/api/auth/me/preferences').send({ workingClass: false })).status).toBe(401);
  });
});
