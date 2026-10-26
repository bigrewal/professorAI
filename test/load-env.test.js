import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

test('loads local credentials ahead of defaults while preserving shell values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'professor-env-'));
  try {
    await mkdir(join(directory, 'server'));
    const loader = join(directory, 'server/load-env.mjs');
    await copyFile(new URL('../server/load-env.js', import.meta.url), loader);
    const run = (env = {}) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      `import ${JSON.stringify(pathToFileURL(loader).href)}; console.log(JSON.stringify({ key: process.env.XAI_API_KEY, port: process.env.PORT }));`,
    ], { env, encoding: 'utf8' }));

    assert.deepEqual(run(), {});
    await writeFile(join(directory, '.env'), 'XAI_API_KEY=default-test-key\nPORT=3000\n');
    assert.deepEqual(run(), { key: 'default-test-key', port: '3000' });
    await writeFile(join(directory, '.env.local'), '# local credential\nXAI_API_KEY="local-test-key"\n');
    assert.deepEqual(run(), { key: 'local-test-key', port: '3000' });
    assert.deepEqual(run({ XAI_API_KEY: 'shell-test-key' }), { key: 'shell-test-key', port: '3000' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
