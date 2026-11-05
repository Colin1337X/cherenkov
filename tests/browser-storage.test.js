const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const X = require('../core/xenon');
const { workspace } = require('./fixtures');
function environment(localStorage) {
  const context = vm.createContext({ Xenon: X, localStorage, DOMException, AbortSignal, location: { protocol: 'file:' }, navigator: {}, fetch });
  vm.runInContext(fs.readFileSync(require.resolve('../adapters/browser-storage'), 'utf8'), context);
  return context.XenonStorage;
}
function local() { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; }
test('browser adapter provides localStorage fallback, reload, backups, conflict detection and quota errors', async () => {
  const storage = local(), adapter = environment(storage), warnings = [];
  const first = await adapter.open({ protocol: 'file:', storage: {}, onWarning: x => warnings.push(x) });
  const second = await adapter.open({ protocol: 'file:', storage: {}, onWarning: x => warnings.push(x) });
  assert.equal(first.mode, 'localStorage'); await first.save(workspace());
  await assert.rejects(second.save(workspace()), /Another tab/); assert(second.failed);
  const reloaded = await adapter.open({ protocol: 'file:', storage: {} }); assert.equal(reloaded.data.records[3].content, workspace().records[3].content);
  assert((await reloaded.listBackups()).includes('xenon-backup'));
  const originalSet = storage.setItem; storage.setItem = (key, value) => { if (key === 'xenon-workspace') throw new Error('Quota exceeded'); originalSet(key, value); };
  await assert.rejects(reloaded.save(workspace()), /Quota/);
  assert.equal(JSON.parse(storage.getItem('xenon-workspace')).records[3].content, workspace().records[3].content);
});
test('memory fallback warns explicitly, stays usable and retains text for export', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const warnings = [], adapter = environment(blocked), opened = await adapter.open({ protocol: 'file:', storage: {}, onWarning: x => warnings.push(x) });
  assert.equal(opened.mode, 'memory'); assert(warnings.some(x => x.includes('Persistence is unavailable')));
  await opened.save(workspace());
  const directory = adapter.memoryDirectory(workspace().records), handle = await directory.getFileHandle('scene-1.json');
  assert.equal(JSON.parse(await (await handle.getFile()).text()).content, workspace().records[3].content);
  await assert.rejects(opened.backup(), /unavailable/);
});
test('OPFS migrates immutable-ID legacy record files, backs up source and preserves originals', async () => {
  const adapter = environment(local()), records = adapter.memoryDirectory(workspace().records), root = adapter.memoryDirectory([]);
  root.getDirectoryHandle = async name => { assert.equal(name, 'records'); return records; };
  const opened = await adapter.open({ protocol: 'file:', storage: { getDirectory: async () => root } });
  assert.equal(opened.mode, 'opfs'); assert.equal(opened.data.records.length, 4);
  assert((await opened.listBackups()).length > 0);
  await opened.save(opened.data);
  const newCopy = await adapter.open({ protocol: 'file:', storage: { getDirectory: async () => root } });
  assert.equal(newCopy.data.schemaVersion, 2); assert.equal(newCopy.data.records[3].id, 'scene-1');
  assert(await records.getFileHandle('scene-1.json'));
});
