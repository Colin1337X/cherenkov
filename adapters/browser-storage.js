/* Browser/Node runtime adapter. The legacy record API operates on one shared snapshot. */
(function (root) {
  'use strict';
  const memorySettings = new Map();
  const settings = {
    getItem(key) { try { return localStorage.getItem(key) ?? memorySettings.get(key) ?? null; } catch { return memorySettings.get(key) ?? null; } },
    setItem(key, value) { memorySettings.set(key, String(value)); try { localStorage.setItem(key, value); } catch { /* Workspace storage reports durability separately. */ } },
    removeItem(key) { memorySettings.delete(key); try { localStorage.removeItem(key); } catch {} }
  };
  function memoryDirectory(records) {
    const files = new Map(records.map(r => [r.id + '.json', JSON.stringify(r)]));
    return {
      async getFileHandle(name, { create = false } = {}) {
        if (!files.has(name)) {
          if (!create) throw new DOMException('Not found.', 'NotFoundError');
          files.set(name, '');
        }
        return { kind: 'file', name, getFile: async () => ({ text: async () => files.get(name) }), createWritable: async () => {
          let pending;
          return { write: async text => { pending = text; }, close: async () => { files.set(name, pending); } };
        } };
      },
      async *values() { for (const name of files.keys()) yield await this.getFileHandle(name); },
      async removeEntry(name) { if (!files.delete(name)) throw new DOMException('Not found.', 'NotFoundError'); }
    };
  }
  async function readHandle(directory, name) { return JSON.parse(await (await directory.getFileHandle(name)).getFile().then(f => f.text())); }
  async function writeHandle(directory, name, data) {
    const file = await directory.getFileHandle(name, { create: true }), writer = await file.createWritable();
    try { await writer.write(JSON.stringify(data)); await writer.close(); }
    catch (error) { await writer.abort?.().catch(() => {}); throw error; }
  }
  async function open({ fetchImpl = fetch, protocol = location.protocol, storage = navigator.storage, onWarning = () => {} } = {}) {
    const X = root.Xenon;
    let mode = 'memory', source, opfs, etag, version = 0, queue = Promise.resolve(), failed = false;
    let serverProfiles = [];
    if (protocol !== 'file:') {
      let response;
      try { response = await fetchImpl('/api/runtime', { signal: AbortSignal.timeout(2500) }); } catch {}
      if (response?.status === 401 || response?.status === 403) throw new Error('Node storage requires authentication. Reload and sign in.');
      if (response?.ok && response.headers.get('content-type')?.includes('application/json')) {
        const runtime = await response.json();
        if (runtime.runtime === 'xenon-node') {
          const saved = await fetchImpl('/api/user');
          if (!saved.ok) throw new Error('Server workspace could not be loaded. No data was replaced.');
          source = await saved.json(); etag = saved.headers.get('etag'); mode = 'node'; serverProfiles = runtime.profiles;
        }
      }
    }
    if (!source) {
      try { opfs = await storage?.getDirectory?.(); } catch {}
      if (opfs) {
        mode = 'opfs';
        try { source = await readHandle(opfs, 'user.json'); }
        catch (error) {
          if (error.name !== 'NotFoundError') throw new Error('Browser workspace is unreadable. Recover an export; no data was replaced.');
          const records = [];
          try {
            const directory = await opfs.getDirectoryHandle('records');
            for await (const file of directory.values()) if (file.kind === 'file' && file.name.endsWith('.json')) records.push(JSON.parse(await (await file.getFile()).text()));
          } catch (legacyError) { if (legacyError.name !== 'NotFoundError') throw new Error('Legacy OPFS records are unreadable. Export from Cherenkov before migrating.'); }
          source = { schemaVersion: 1, records, config: JSON.parse(settings.getItem('config') || '{}'), trackers: JSON.parse(settings.getItem('trackers') || '[]'), siteColor: settings.getItem('siteColor') || 'cyan' };
        }
      } else {
        let persistent = false;
        try { localStorage.setItem('xenon-probe', '1'); localStorage.removeItem('xenon-probe'); persistent = true; } catch {}
        mode = persistent ? 'localStorage' : 'memory';
        try { source = JSON.parse(settings.getItem('xenon-workspace') || 'null'); } catch { throw new Error('Browser workspace JSON is invalid. Preserve it before recovery.'); }
        source ||= { schemaVersion: 2, records: [], config: JSON.parse(settings.getItem('config') || '{}') };
      }
    }
    const original = X.clone(source);
    let data = X.migrate(source); version = data.storageVersion || 0;
    const directory = memoryDirectory(data.records);
    if (mode === 'memory') onWarning('Persistence is unavailable. Export your work before closing this page.');
    if (protocol === 'file:') onWarning('Raw HTML mode: browser storage may be temporary or specific to this file. Export backups. Direct inference requires endpoint CORS support; browser credentials are accessible in this browser.');
    async function backup(snapshot = data) {
      if (mode === 'node') {
        const response = await fetchImpl('/api/backups', { method: 'POST' });
        if (!response.ok) throw new Error('Backup failed.');
        return (await response.json()).id;
      }
      if (mode === 'opfs') { const name = 'backup-' + Date.now() + '-' + X.uid() + '.json'; await writeHandle(opfs, name, snapshot); return name; }
      if (mode === 'localStorage') { localStorage.setItem('xenon-backup', JSON.stringify(snapshot)); return 'xenon-backup'; }
      throw new Error('Persistent backups are unavailable. Use Export.');
    }
    // First schema change gets a recoverable original copy, including legacy OPFS record files.
    if (original.schemaVersion !== 2 && mode !== 'memory') await backup(original);
    function save(value) {
      const snapshot = X.migrate(value);
      const commit = async () => {
        if (failed) throw new Error('Storage conflict/failure is unresolved. Export your local work, then reload.');
        try {
          if (mode === 'node') {
            const response = await fetchImpl('/api/user', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify(snapshot) });
            if (!response.ok) throw new Error(response.status === 409 ? 'Another session changed this workspace. Export your local work before reloading.' : 'Server save failed. Export your work before reloading.');
            etag = response.headers.get('etag');
          } else if (mode === 'opfs') {
            let disk;
            try { disk = await readHandle(opfs, 'user.json'); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
            if ((disk?.storageVersion || 0) !== version) throw new Error('Another tab changed this workspace. Export your local work before reloading.');
            await backup(data);
            snapshot.storageVersion = ++version;
            await writeHandle(opfs, 'user.json', snapshot);
          } else if (mode === 'localStorage') {
            const disk = JSON.parse(localStorage.getItem('xenon-workspace') || 'null');
            if ((disk?.storageVersion || 0) !== version) throw new Error('Another tab changed this workspace. Export before reloading.');
            await backup(data); snapshot.storageVersion = ++version;
            localStorage.setItem('xenon-workspace', JSON.stringify(snapshot));
          }
          data = snapshot;
        } catch (error) { failed = true; onWarning(error.message); throw error; }
      };
      // The version comparison and replacement must be one transaction across tabs.
      const operation = queue.then(() => root.navigator?.locks && ['opfs', 'localStorage'].includes(mode)
        ? root.navigator.locks.request('xenon-workspace', commit) : commit());
      queue = operation.catch(() => {}); return operation;
    }
    async function listBackups() {
      if (mode === 'node') { const response = await fetchImpl('/api/backups'); if (!response.ok) throw new Error('Backups could not be read.'); return response.json(); }
      if (mode === 'opfs') { const names = []; for await (const file of opfs.values()) if (file.name.startsWith('backup-')) names.push(file.name); return names.sort().reverse(); }
      return mode === 'localStorage' && settings.getItem('xenon-backup') ? ['xenon-backup'] : [];
    }
    async function readBackup(id) {
      if (mode === 'node') { const response = await fetchImpl('/api/backups/' + encodeURIComponent(id)); if (!response.ok) throw new Error('Backup could not be read.'); return response.json(); }
      if (mode === 'opfs' && /^backup-[\w-]+\.json$/.test(id)) return readHandle(opfs, id);
      if (mode === 'localStorage' && id === 'xenon-backup') return JSON.parse(settings.getItem(id));
      throw new Error('Invalid backup.');
    }
    return { mode, data, directory, serverProfiles, save, backup, listBackups, readBackup, drain: () => queue, get failed() { return failed; } };
  }
  root.XenonStorage = { open, settings, memoryDirectory };
})(globalThis);
