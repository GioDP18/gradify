/**
 * Retrieves, validates, and versions grading configurations.
 * One configuration history for the whole system (D21): version 1 = the official EVSU criteria,
 * created the first time it is needed; the administrator creates later versions.
 */
import { GradingConfiguration } from '../../models/GradingConfiguration.js';
import { ApiError } from '../../utils/ApiError.js';
import { runInTransaction } from '../../utils/transaction.js';
import { recordAudit } from '../audit.service.js';
import { officialConfigurationTemplate } from './grading.defaults.js';
import { validateConfiguration } from './grading.validation.js';

const RULE_FIELDS = ['name', 'notes', 'periodWeights', 'periods', 'computationRules', 'roundingRules', 'gradeConversion', 'incompleteRule'];

export function toPublicConfiguration(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: o._id.toString(),
    version: o.version,
    isActive: o.isActive,
    effectiveDate: o.effectiveDate,
    name: o.name,
    source: o.source ?? null,
    notes: o.notes ?? null,
    periodWeights: o.periodWeights,
    periods: o.periods,
    computationRules: o.computationRules,
    roundingRules: o.roundingRules,
    gradeConversion: o.gradeConversion,
    incompleteRule: o.incompleteRule,
    createdAt: o.createdAt,
  };
}

/** Returns the active configuration, creating version 1 (official criteria) if none exists. */
export async function getActiveConfiguration({ session } = {}) {
  const active = await GradingConfiguration.findOne({ isActive: true }).session(session ?? null).lean();
  if (active) return active;

  const template = officialConfigurationTemplate();
  const problems = validateConfiguration(template);
  if (problems.length) throw new Error(`Official grading template is invalid: ${JSON.stringify(problems)}`);
  try {
    const [created] = await GradingConfiguration.create(
      [{ ...template, version: 1, isActive: true }],
      { session },
    );
    await recordAudit(
      { action: 'GRADING_CONFIG_SEED', collection: 'gradingConfigurations', recordId: created._id, newValue: { version: 1, name: template.name } },
      { session },
    );
    return created.toObject();
  } catch (error) {
    // Another request seeded it at the same moment.
    if (error?.code === 11000) return GradingConfiguration.findOne({ isActive: true }).session(session ?? null).lean();
    throw error;
  }
}

export async function listVersions() {
  await getActiveConfiguration();
  const docs = await GradingConfiguration.find({}).sort({ version: -1 }).lean();
  return docs.map(toPublicConfiguration);
}

export async function getVersion(version) {
  const doc = await GradingConfiguration.findOne({ version }).lean();
  if (!doc) throw ApiError.notFound('That criteria version was not found.');
  return doc;
}

/**
 * Creates and activates a new version from the active one plus `changes`.
 * The previous version is deactivated (never modified otherwise) in the same transaction.
 * Returns { previous, current } so callers can trigger recalculation.
 */
export async function createVersion(adminId, changes, req) {
  return runInTransaction(async (session) => {
    const active = await getActiveConfiguration({ session });
    const next = { ...Object.fromEntries(RULE_FIELDS.map((f) => [f, active[f]])), ...changes };
    const problems = validateConfiguration(next);
    if (problems.length) throw ApiError.validation(problems, 'The grading criteria are not valid.');

    await GradingConfiguration.updateOne({ _id: active._id }, { $set: { isActive: false } }, { session });
    const [created] = await GradingConfiguration.create(
      [{ ...next, source: active.source, version: active.version + 1, isActive: true, effectiveDate: new Date(), createdBy: adminId }],
      { session },
    );
    await recordAudit(
      {
        userId: adminId,
        action: 'GRADING_CONFIG_VERSION',
        collection: 'gradingConfigurations',
        recordId: created._id,
        previousValue: { version: active.version, periodWeights: active.periodWeights, periods: active.periods },
        newValue: { version: created.version, periodWeights: created.periodWeights, periods: created.periods, notes: created.notes },
        req,
      },
      { session },
    );
    return { previous: active, current: created.toObject() };
  });
}
