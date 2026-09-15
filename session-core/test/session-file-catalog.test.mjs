import assert from "node:assert/strict";
import test from "node:test";

import { createSessionFileCatalog } from "../src/providers/session-file-catalog.mjs";

test("session file catalog reuses unchanged summaries and invalidates changed dependencies", async () => {
  let files = ["/sessions/one.jsonl", "/sessions/two.jsonl"];
  let contextVersion = "index-one";
  const versions = new Map([
    [files[0], 1],
    [files[1], 1]
  ]);
  const loads = new Map();

  const catalog = createSessionFileCatalog({
    discoverFiles: async () => files,
    loadContext: async () => ({ version: contextVersion }),
    dependencyKey: (_filePath, context) => context.version,
    statFile: async (filePath) => fakeStat(versions.get(filePath)),
    loadFile: async (filePath, { context }) => {
      loads.set(filePath, (loads.get(filePath) ?? 0) + 1);
      return sessionForPath(filePath, context.version);
    }
  });

  const first = await catalog.listSessions();
  const second = await catalog.listSessions();

  assert.equal(loadCount(loads), 2);
  assert.strictEqual(second[0], first[0]);

  versions.set(files[0], 2);
  const changedFile = await catalog.listSessions();
  assert.equal(loads.get(files[0]), 2);
  assert.equal(loads.get(files[1]), 1);
  assert.notStrictEqual(changedFile[0], first[0]);
  assert.strictEqual(changedFile[1], first[1]);

  contextVersion = "index-two";
  const changedDependency = await catalog.listSessions();
  assert.equal(loads.get(files[0]), 3);
  assert.equal(loads.get(files[1]), 2);
  assert.equal(changedDependency[0].title, "index-two");

  files = [files[0]];
  await catalog.listSessions();
  assert.equal((await catalog.resolve("test:two")), null);
  assert.equal((await catalog.resolve("test:one")).filePath, "/sessions/one.jsonl");
});

test("session file catalog coalesces refreshes and bounds file loading concurrency", async () => {
  const files = Array.from({ length: 6 }, (_, index) => `/sessions/${index}.jsonl`);
  let discoveryCalls = 0;
  let activeLoads = 0;
  let maxActiveLoads = 0;

  const catalog = createSessionFileCatalog({
    concurrency: 2,
    discoverFiles: async () => {
      discoveryCalls += 1;
      await nextTurn();
      return files;
    },
    statFile: async () => fakeStat(1),
    loadFile: async (filePath) => {
      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      await nextTurn();
      activeLoads -= 1;
      return sessionForPath(filePath);
    }
  });

  const [first, second, third] = await Promise.all([
    catalog.listSessions(),
    catalog.listSessions(),
    catalog.listSessions()
  ]);

  assert.equal(discoveryCalls, 1);
  assert.equal(maxActiveLoads, 2);
  assert.strictEqual(second, first);
  assert.strictEqual(third, first);
});

test("session file catalog retries transient load failures without caching stale fallbacks", async () => {
  let attempts = 0;
  const catalog = createSessionFileCatalog({
    discoverFiles: async () => ["/sessions/retry.jsonl"],
    statFile: async () => fakeStat(1),
    loadFile: async (filePath) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary read failure");
      }
      return sessionForPath(filePath);
    },
    onFileError: async (_error, filePath) => ({
      ...sessionForPath(filePath),
      quality: "stale"
    })
  });

  const first = await catalog.listSessions();
  const second = await catalog.listSessions();

  assert.equal(first[0].quality, "stale");
  assert.equal(second[0].quality, "partial");
  assert.equal(attempts, 2);
});

function fakeStat(version) {
  return {
    dev: 1,
    ino: version,
    size: version * 10,
    mtimeMs: version * 100,
    ctimeMs: version * 100
  };
}

function sessionForPath(filePath, title = "session") {
  const name = filePath.match(/([^/]+)\.jsonl$/)?.[1];
  return {
    id: `test:${name}`,
    title,
    quality: "partial",
    sources: [
      {
        kind: "session-file",
        path: filePath
      }
    ]
  };
}

function loadCount(loads) {
  return [...loads.values()].reduce((total, count) => total + count, 0);
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}
