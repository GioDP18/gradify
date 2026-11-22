import { inject, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

/**
 * Connects this test file to its own database on the shared in-memory replica set
 * and wipes all collections between tests.
 */
export function useTestDatabase() {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID().slice(0, 8)}`, autoIndex: true });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
