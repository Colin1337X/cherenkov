'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { migrate } = require('../core/xenon');

async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, filename);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
function createStore(directory, legacyFile) {
  const filename = path.join(directory, 'workspace.json');
  let data, version = 0, queue = Promise.resolve();
  async function load() {
    if (data) return { data: structuredClone(data), version };
    let source;
    try { source = JSON.parse(await fs.readFile(filename, 'utf8')); version = source.storageVersion || 0; }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Workspace cannot be read. Preserve the file and recover a backup.');
      try { source = JSON.parse(await fs.readFile(legacyFile, 'utf8')); }
      catch (legacyError) { if (legacyError.code !== 'ENOENT') throw new Error('Legacy user.json is invalid.'); source = { records: [], config: {}, schemaVersion: 2 }; }
    }
    data = migrate(source);
    return { data: structuredClone(data), version };
  }
  async function backup(value) {
    const id = Date.now() + '-' + randomUUID() + '.json';
    await atomicJson(path.join(directory, 'backups', id), value);
    return id;
  }
  function save(value, expected) {
    const operation = queue.then(async () => {
      await load();
      if (Number(expected) !== version) throw Object.assign(new Error('Workspace changed in another session. Export your local copy before reloading.'), { status: 409 });
      const next = migrate(value);
      await backup(data);
      next.storageVersion = version + 1;
      await atomicJson(filename, next);
      data = next; version++;
      return { version };
    });
    queue = operation.catch(() => {});
    return operation;
  }
  async function listBackups() {
    try { return (await fs.readdir(path.join(directory, 'backups'))).filter(x => /^\d+-[a-f0-9-]+\.json$/.test(x)).sort().reverse(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function readBackup(id) {
    if (!/^\d+-[a-f0-9-]+\.json$/.test(id)) throw Object.assign(new Error('Invalid backup ID.'), { status: 400 });
    return fs.readFile(path.join(directory, 'backups', id));
  }
  return { load, save, backup: async () => backup((await load()).data), listBackups, readBackup, drain: () => queue };
}
module.exports = { createStore, atomicJson };
