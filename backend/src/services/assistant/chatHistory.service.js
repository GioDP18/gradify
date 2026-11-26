/**
 * The assistant's chat history, saved to the person's account so it is the same on any device.
 *
 * Saving follows the account's "Keep chat history" setting (Settings > Assistant): while it is on,
 * each conversation is saved after every answer; while it is off, nothing new is saved. Turning it
 * off never deletes anything: the saved chats are there again when it is turned back on, and a chat
 * goes only when the person deletes it (or it falls out of the most recent ones kept). A person
 * only ever sees, opens or deletes their own chats (anyone else's is "not found").
 */
import mongoose from 'mongoose';
import { AssistantChat } from '../../models/AssistantChat.js';
import { User } from '../../models/User.js';
import { ApiError } from '../../utils/ApiError.js';

/** Only the most recent chats are kept per account. */
export const MAX_CHATS = 50;
const TITLE_LENGTH = 60;

const notFound = () => ApiError.notFound('That chat was not found. It may have been deleted.');
const summary = (chat) => ({ id: chat._id.toString(), title: chat.title, updatedAt: chat.updatedAt });

/** A chat is named after its first question. */
export function chatTitle(messages) {
  const first = (messages.find((m) => m.role === 'user')?.content ?? 'New chat').replace(/\s+/g, ' ').trim();
  return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : first;
}

/** Whether this account keeps its chat history (on unless turned off). */
export async function keepsHistory(userId) {
  const user = await User.findById(userId).select('preferences').lean();
  return user?.preferences?.chatHistory ?? true;
}

/** The account's saved chats, newest first, without their messages. */
export async function listChats(userId) {
  const chats = await AssistantChat.find({ user: userId }).select('title updatedAt').sort({ updatedAt: -1 }).limit(MAX_CHATS).lean();
  return chats.map(summary);
}

export async function getChat(userId, chatId) {
  if (!mongoose.isValidObjectId(chatId)) throw notFound();
  const chat = await AssistantChat.findOne({ _id: chatId, user: userId }).lean();
  if (!chat) throw notFound();
  return { ...summary(chat), messages: chat.messages.map(({ role, content }) => ({ role, content })) };
}

/**
 * Saves a conversation after an answer: updates the account's chat `chatId`, or files a new chat
 * when there is none (or it no longer exists). Returns the chat's listing, or null when the
 * account does not keep history.
 */
export async function saveConversation(userId, chatId, messages) {
  if (!(await keepsHistory(userId))) return null;
  const clean = messages.map(({ role, content }) => ({ role, content }));

  if (chatId && mongoose.isValidObjectId(chatId)) {
    const updated = await AssistantChat.findOneAndUpdate({ _id: chatId, user: userId }, { $set: { messages: clean } }, { new: true }).select('title updatedAt').lean();
    if (updated) return summary(updated);
  }

  const created = await AssistantChat.create({ user: userId, title: chatTitle(clean), messages: clean });
  // Keep only the most recent chats.
  const extra = await AssistantChat.find({ user: userId }).select('_id').sort({ updatedAt: -1 }).skip(MAX_CHATS).lean();
  if (extra.length) await AssistantChat.deleteMany({ _id: { $in: extra.map((c) => c._id) } });
  return summary(created);
}

export async function deleteChat(userId, chatId) {
  if (!mongoose.isValidObjectId(chatId)) throw notFound();
  const { deletedCount } = await AssistantChat.deleteOne({ _id: chatId, user: userId });
  if (!deletedCount) throw notFound();
}
