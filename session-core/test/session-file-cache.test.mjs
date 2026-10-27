import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSessionFileCache } from '../src/providers/session-file-io.mjs';

test('an unchanged log is parsed once; appends, rewrites and failures parse again', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'palmdesk-session-cache-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'session.jsonl');
  await writeFile(file, '{"a":1}\n');
  const cache = createSessionFileCache();
  let parses = 0;
  const parse = () => {
    parses += 1;
    return Promise.resolve({ parse: parses });
  };

  assert.deepEqual(await cache(file, parse), { parse: 1 });
  assert.deepEqual(await cache(file, parse), { parse: 1 });
  await appendFile(file, '{"b":2}\n');
  assert.deepEqual(await cache(file, parse), { parse: 2 });
  // Same size, new modification time.
  await writeFile(file, '{"c":3}\n{"d":4}\n');
  await utimes(file, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(await cache(file, parse), { parse: 3 });

  await appendFile(file, '{"e":5}\n');
  await assert.rejects(
    cache(file, () => Promise.reject(new Error('unreadable')))
  );
  // The failure is not cached for the same file state.
  assert.deepEqual(await cache(file, parse), { parse: 4 });
  await rm(file);
  await assert.rejects(cache(file, parse), /ENOENT/);
});
