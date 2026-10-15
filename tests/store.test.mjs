import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkStore } = require('../electron/store.cjs');

test('作品可保存、重启后读取，并拒绝不支持的数据', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stylecam-store-'));
  try {
    const store = new WorkStore(root);
    const item = await store.save({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', sourceName: '原图', styleId: 'wool', styleName: '毛线手作', intensity: 60, provider: 'sample' });
    assert.equal(item.provider, 'sample');
    const reopened = new WorkStore(root);
    const works = await reopened.list();
    assert.equal(works.length, 1);
    assert.equal(works[0].id, item.id);
    assert.equal((await reopened.fileFor(item.id)).work.styleId, 'wool');
    await assert.rejects(store.save({ dataUrl: 'data:text/html;base64,PGgxPg==' }), /有效/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
