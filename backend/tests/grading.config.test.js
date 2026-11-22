import { describe, it, expect } from 'vitest';
import { GradingConfiguration } from '../src/models/GradingConfiguration.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/models/User.js';
import { getActiveConfiguration, createVersion, listVersions } from '../src/services/grading/grading.config.service.js';
import { useTestDatabase } from './helpers/db.js';
import { createUser } from './helpers/factories.js';

useTestDatabase();

describe('grading configuration service (one shared history, D21)', () => {
  it('seeds version 1 from the official criteria the first time, exactly once (even concurrently)', async () => {
    const [a, b] = await Promise.all([getActiveConfiguration(), getActiveConfiguration()]);
    expect(a._id.toString()).toBe(b._id.toString());
    expect(await GradingConfiguration.countDocuments({})).toBe(1);
    expect(a).toMatchObject({ version: 1, isActive: true, periodWeights: { MIDTERM: 40, FINALS: 60 } });
    expect(a.periods.MIDTERM.components.map((c) => c.weight)).toEqual([10, 30, 20, 40]);
    expect(await AuditLog.countDocuments({ action: 'GRADING_CONFIG_SEED' })).toBe(1);
  });

  it('a new version applies to everyone', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    await getActiveConfiguration();
    await createVersion(admin._id, { periodWeights: { MIDTERM: 50, FINALS: 50 } });
    expect((await getActiveConfiguration()).periodWeights).toEqual({ MIDTERM: 50, FINALS: 50 });
    expect((await GradingConfiguration.findOne({ version: 2 }).lean()).createdBy.toString()).toBe(admin._id.toString());
  });

  it('creates a new active version without overwriting the old one, and audits it', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const v1 = await getActiveConfiguration();
    const periods = JSON.parse(JSON.stringify(v1.periods));
    periods.MIDTERM.components[1].weight = 25;
    periods.MIDTERM.components[2].weight = 25;
    const { previous, current } = await createVersion(admin._id, { periods, notes: 'Department adjustment' });
    expect(previous.version).toBe(1);
    expect(current).toMatchObject({ version: 2, isActive: true, notes: 'Department adjustment' });

    const versions = await listVersions();
    expect(versions.map((v) => [v.version, v.isActive])).toEqual([[2, true], [1, false]]);
    expect(versions[1].periods.MIDTERM.components[1].weight).toBe(30); // history intact
    const entry = await AuditLog.findOne({ action: 'GRADING_CONFIG_VERSION' }).lean();
    expect(entry.user.toString()).toBe(admin._id.toString());
    expect(entry.previousValue.version).toBe(1);
    expect(entry.newValue.version).toBe(2);
  });

  it('refuses invalid versions and leaves the active one untouched', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    await getActiveConfiguration();
    await expect(createVersion(admin._id, { periodWeights: { MIDTERM: 40, FINALS: 50 } })).rejects.toMatchObject({ statusCode: 422 });
    expect((await getActiveConfiguration()).version).toBe(1);
    expect(await GradingConfiguration.countDocuments({})).toBe(1);
  });

  it('allows only one active version in the system (database constraint)', async () => {
    const v1 = await getActiveConfiguration();
    const { _id, ...copy } = v1;
    await expect(GradingConfiguration.create({ ...copy, version: 99, isActive: true })).rejects.toMatchObject({ code: 11000 });
  });
});
