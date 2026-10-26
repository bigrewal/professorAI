import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, rename, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'professor-store-'));
process.env.PROFESSORAI_DATA_DIR = directory;
const { readCatalog, updateCatalog } = await import('../server/lib/store.js');
after(() => rm(directory, { recursive: true, force: true }));

test('catalog updates are isolated, serialized, and committed only after persistence', async () => {
  await updateCatalog((catalog) => { catalog.settings.label = 'original'; });
  await assert.rejects(updateCatalog((catalog) => {
    catalog.settings.label = 'uncommitted';
    throw new Error('Stop transaction');
  }), /Stop transaction/);
  assert.equal((await readCatalog()).settings.label, 'original');

  const snapshot = await readCatalog();
  snapshot.settings.label = 'external mutation';
  assert.equal((await readCatalog()).settings.label, 'original');

  const result = await updateCatalog((catalog) => catalog.settings);
  result.label = 'result mutation';
  assert.equal((await readCatalog()).settings.label, 'original');

  // A directory at the destination forces an atomic rename failure, even as root.
  const path = join(directory, 'catalog.json');
  await rename(path, `${path}.backup`);
  await mkdir(path);
  await assert.rejects(updateCatalog((catalog) => { catalog.settings.label = 'failed write'; }));
  assert.equal((await readCatalog()).settings.label, 'original');
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);

  await Promise.all(Array.from({ length: 10 }, () => updateCatalog(async (catalog) => {
    const value = catalog.settings.count || 0;
    await new Promise((resolve) => setImmediate(resolve));
    catalog.settings.count = value + 1;
  })));
  assert.equal((await readCatalog()).settings.count, 10);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).settings.count, 10);
});


test('unsupported catalogs are preserved and consistently rejected', async () => {
  const unsupportedDir = join(directory, 'unsupported');
  await mkdir(unsupportedDir);
  const path = join(unsupportedDir, 'catalog.json');
  const source = JSON.stringify({version: 999, courses: [{id: 'keep-me'}]});
  await writeFile(path, source);
  process.env.PROFESSORAI_DATA_DIR = unsupportedDir;
  const { readCatalog: readUnsupported } = await import('../server/lib/store.js?unsupported');
  await assert.rejects(readUnsupported(), /unsupported format/);
  await assert.rejects(readUnsupported(), /unsupported format/);
  assert.equal(await readFile(path, 'utf8'), source);
});

test('migrates legacy explanations and preserves them across a fresh catalog load', async () => {
  const legacyDirectory = join(directory, 'legacy');
  await mkdir(legacyDirectory);
  const path = join(legacyDirectory, 'catalog.json');
  await writeFile(path, JSON.stringify({ version: 2, settings: {}, courses: [{ id: 'legacy-course', chat: [
    { id: 'old-explanation', kind: 'explain', role: 'teacher', documentId: 'pdf', page: 12, text: 'An explanation from an earlier study session.', createdAt: '2026-10-01T12:00:00.000Z' },
  ] }] }));
  process.env.PROFESSORAI_DATA_DIR = legacyDirectory;
  const migrated = await import('../server/lib/store.js?legacy-migration');
  const catalog = await migrated.readCatalog();
  assert.equal(catalog.courses[0].pageExplanations[0].page, 12);
  assert.equal(catalog.courses[0].pageExplanations[0].explainedAt, '2026-10-01T12:00:00.000Z');
  await migrated.updateCatalog((current) => { current.courses[0].chat = []; });
  const reloaded = await import('../server/lib/store.js?legacy-reloaded');
  const reopened = await reloaded.readCatalog();
  assert.equal(reopened.courses[0].pageExplanations[0].text, 'An explanation from an earlier study session.');
  assert.deepEqual(reopened.courses[0].chat, []);
});
