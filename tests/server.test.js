const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createApp, staticPath } = require('../server');
const { createStore } = require('../adapters/node-storage');
const { workspace } = require('./fixtures');
async function temporary(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xenon-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
test('native storage is atomic, serializes writers, detects conflicts, preserves backups and survives restart', async t => {
  const directory = await temporary(t), legacy = path.join(directory, 'user.json'); await fs.writeFile(legacy, JSON.stringify(workspace()));
  const store = createStore(path.join(directory, 'data'), legacy); const original = await store.load();
  const next = structuredClone(original.data); next.records[3].content = 'New draft';
  const results = await Promise.allSettled([store.save(next, 0), store.save(next, 0)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].reason.status, 409);
  const backups = await store.listBackups(); assert.equal(backups.length, 1);
  assert.equal(JSON.parse(await store.readBackup(backups[0])).records[3].content, 'Mara walked into the garden.');
  assert.equal((await createStore(path.join(directory, 'data'), legacy).load()).data.records[3].content, 'New draft');
  assert.equal(JSON.parse(await fs.readFile(legacy, 'utf8')).schemaVersion, 1);
  await assert.rejects(store.readBackup('../user.json'));
});
test('corrupt storage fails without overwriting it', async t => {
  const directory = await temporary(t); await fs.writeFile(path.join(directory, 'workspace.json'), 'broken');
  await assert.rejects(createStore(directory, path.join(directory, 'none')).load(), /cannot be read/);
  assert.equal(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8'), 'broken');
});
test('HTTP app preserves data, enforces origin/host/ETag/validation and keeps private files private', async t => {
  const directory = await temporary(t), app = await createApp({ dataDir: directory }); const address = await app.listen(0); t.after(() => app.close());
  const base = 'http://127.0.0.1:' + address.port;
  assert.equal((await fetch(base + '/')).status, 200);
  for (const filename of ['/user.json', '/.git/config', '/.xenon/workspace.json', '/server.js', '/adapters/node-storage.js', '/%2e%2e/LICENSE', '/%5c..%5cuser.json']) assert.equal((await fetch(base + filename)).status, 404, filename);
  assert.throws(() => staticPath(__dirname, '/../secret'));
  assert.equal((await fetch(base + '/api/user', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(base + '/api/user', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(base + '/api/user', { method: 'PUT', body: '{}' })).status, 428);
  let response = await fetch(base + '/api/user'), etag = response.headers.get('etag');
  response = await fetch(base + '/api/user', { method: 'PUT', headers: { 'If-Match': etag }, body: JSON.stringify(workspace()) }); assert.equal(response.status, 200);
  assert.equal((await fetch(base + '/api/user', { method: 'PUT', headers: { 'If-Match': etag }, body: JSON.stringify(workspace()) })).status, 409);
  assert.equal((await fetch(base + '/api/user')).status, 200);
  response = await fetch(base + '/api/backups'); assert((await response.json()).length);
});
test('remote binding requires explicit strong authentication', async t => {
  const directory = await temporary(t);
  await assert.rejects(createApp({ host: '0.0.0.0', dataDir: directory }), /requires/);
  const app = await createApp({ token: 'test-token-12345678901234567890', dataDir: directory }); const address = await app.listen(0); t.after(() => app.close());
  assert.equal((await fetch('http://127.0.0.1:' + address.port + '/api/user')).status, 401);
  assert.equal((await fetch('http://127.0.0.1:' + address.port + '/api/user', { headers: { Authorization: 'Bearer test-token-12345678901234567890' } })).status, 200);
});
test('proxy uses configured destinations, strips secrets, disallows redirects and supports persistent jobs', async t => {
  let sawKey = false;
  const mock = http.createServer(async (request, response) => {
    sawKey ||= request.headers.authorization === 'Bearer secret-test-key';
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); return response.end('{"data":[{"id":"mock","secret":"not-public"}]}'); }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (body.model === 'redirect') { response.writeHead(302, { Location: 'http://example.com' }); return response.end(); }
    if (body.model === 'error') { response.writeHead(500); return response.end('secret-test-key'); }
    response.setHeader('Content-Type', 'text/event-stream');
    response.end('data: {"choices":[{"delta":{"content":"A safe draft.","reasoning":"Plan"}}]}\n\ndata: {"usage":{"completion_tokens":4}}\n\ndata: [DONE]\n\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); t.after(() => new Promise(r => mock.close(r)));
  const directory = await temporary(t), options = { dataDir: directory, profiles: { default: { endpoint: 'http://127.0.0.1:' + mock.address().port + '/v1', apiKey: 'secret-test-key' } } };
  const app = await createApp(options), address = await app.listen(0); let closed = false; t.after(() => closed ? undefined : app.close());
  const base = 'http://127.0.0.1:' + address.port;
  const body = { model: 'mock', messages: [{ role: 'user', content: 'draft' }], stream: true };
  const post = (route, data) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let response = await post('/api/inference', { profile: 'default', body }); const output = await response.text(); assert(output.includes('A safe draft.')); assert(!output.includes('secret-test-key')); assert(sawKey);
  assert.equal((await post('/api/inference', { profile: 'http://evil.example', body })).status, 400);
  assert.equal((await post('/api/inference', { body: { ...body, endpoint: 'http://evil.example' } })).status, 400);
  assert.equal((await post('/api/inference', { body: { ...body, stream: {} } })).status, 400);
  assert.equal((await post('/api/inference', { body: { ...body, messages: [{ role: 'user', content: 'x'.repeat(2_000_001) }] } })).status, 413);
  assert.equal((await post('/api/inference', { body: { ...body, model: 'redirect' } })).status, 400);
  assert(!(await (await post('/api/inference', { body: { ...body, model: 'error' } })).text()).includes('secret-test-key'));
  response = await fetch(base + '/api/models'); assert.deepEqual(await response.json(), { data: [{ id: 'mock' }] });
  response = await post('/api/jobs', { body }); const job = await response.json(); assert.equal(response.status, 202);
  for (let i = 0; i < 50; i++) { const current = await (await fetch(base + '/api/jobs/' + job.id)).json(); if (current.status === 'completed') break; await new Promise(r => setTimeout(r, 20)); }
  assert.equal((await (await fetch(base + '/api/jobs/' + job.id)).json()).status, 'completed');
  await app.close(); closed = true;
  const restarted = await createApp(options); t.after(() => restarted.close()); assert.equal(restarted.jobs.list()[0].content, 'A safe draft.');
});
test('background cancellation preserves partial output and interrupted jobs are recoverable', async t => {
  const directory = await temporary(t);
  const jobsFile = path.join(directory, 'jobs.json');
  await fs.writeFile(jobsFile, JSON.stringify([{ id: 'old-job', status: 'running', content: 'Recovered draft.' }]));
  const mock = http.createServer(async (request, response) => {
    request.resume(); response.setHeader('Content-Type', 'text/event-stream');
    response.write('data: {"choices":[{"delta":{"content":"Partial draft"}}]}\n\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); t.after(() => { mock.closeAllConnections(); return new Promise(r => mock.close(r)); });
  const app = await createApp({ dataDir: directory, profiles: { default: { endpoint: 'http://127.0.0.1:' + mock.address().port + '/v1', apiKey: 'private-key' } } });
  const address = await app.listen(0); t.after(() => app.close());
  assert.equal(app.jobs.get('old-job').status, 'interrupted');
  const base = 'http://127.0.0.1:' + address.port;
  const response = await fetch(base + '/api/jobs', { method: 'POST', body: JSON.stringify({ body: { model: 'mock', messages: [{ role: 'user', content: 'Draft' }] } }) });
  const job = await response.json();
  for (let i = 0; i < 100 && !app.jobs.get(job.id).content; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.jobs.get(job.id).content, 'Partial draft');
  await fetch(base + '/api/jobs/' + job.id + '/cancel', { method: 'POST' });
  for (let i = 0; i < 100 && app.jobs.get(job.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.jobs.get(job.id).status, 'cancelled');
  assert.equal(app.jobs.get(job.id).content, 'Partial draft');
  assert(!(await fs.readFile(jobsFile, 'utf8')).includes('private-key'));
});
