import mongoose from 'mongoose';

/**
 * One saved conversation with the in-app assistant. Chats belong to the account, so the history
 * is the same on every device the person signs in on. They are kept only while the person's
 * "Keep chat history" setting is on (turning it off deletes them all), and only the most recent
 * ones per account are kept (services/assistant/chatHistory.service.js).
 */
const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 20000 },
  },
  { _id: false },
);

const assistantChatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The first question, shortened: what the chat is listed as.
    title: { type: String, required: true, maxlength: 120 },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true, collection: 'assistantChats', versionKey: false },
);

assistantChatSchema.index({ user: 1, updatedAt: -1 });

export const AssistantChat = mongoose.model('AssistantChat', assistantChatSchema);
