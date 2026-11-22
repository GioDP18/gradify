import mongoose from 'mongoose';

/** Append-only record of important changes. There is deliberately no update/delete API. */
const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true, maxlength: 64 },
    affectedCollection: { type: String, required: true, maxlength: 64 },
    recordId: { type: mongoose.Schema.Types.ObjectId },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    previousValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'auditLogs', versionKey: false },
);

auditLogSchema.index({ affectedCollection: 1, recordId: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ class: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }); // retention: find old entries without scanning the collection

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
