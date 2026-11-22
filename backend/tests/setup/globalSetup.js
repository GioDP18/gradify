import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;

/** Starts one in-memory replica set (transactions supported) for the whole test run. */
export async function setup(project) {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    // Keep the test server's memory small; on low-RAM machines the OS otherwise kills it mid-run.
    instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25'] }],
  });
  project.provide('mongoUri', replSet.getUri());
}

export async function teardown() {
  await replSet?.stop();
}
