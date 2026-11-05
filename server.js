'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { once } = require('node:events');
const { createStore } = require('./adapters/node-storage');
const { createJobs } = require('./core/jobs');
const { parse } = require('./ai/providers');

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
async function bodyJson(request, limit = 25_000_000) {
  if (Number(request.headers['content-length']) > limit) { request.resume(); throw failure('Request is too large.', 413); }
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw failure('Request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure('Invalid JSON.'); }
}
function validateCompletion(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length > 200 || !body.messages.length) throw failure('Invalid completion request.');
  if (typeof body.model !== 'string' || !body.model.trim()) throw failure('A model is required.');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw failure('Invalid stream setting.');
  if (body.stream_options !== undefined && (!body.stream_options || typeof body.stream_options !== 'object' || Array.isArray(body.stream_options) || Object.keys(body.stream_options).some(k => k !== 'include_usage') || typeof body.stream_options.include_usage !== 'boolean')) throw failure('Invalid streaming options.');
  for (const message of body.messages) if (!['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw failure('Invalid message.');
  const allowed = ['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'presence_penalty', 'reasoning_effort'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw failure('Unsupported request field.');
  for (const key of ['max_tokens', 'max_completion_tokens']) if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > 131072)) throw failure('Invalid token limit.');
  for (const [key, min, max] of [['temperature', 0, 2], ['top_p', 0, 1], ['presence_penalty', -2, 2]]) if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max)) throw failure('Invalid generation parameter.');
  if (body.reasoning_effort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(body.reasoning_effort)) throw failure('Invalid reasoning effort.');
  return body;
}
function staticPath(root, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (!/^\/(?:index\.html|styles\.css|main\.js|xenon-app\.js|(?:core|ai|adapters)\/[a-z-]+\.js|(?:Jua|VT323)-Regular\.ttf)$/.test(pathname)) throw failure('Not found.', 404);
  if (['/adapters/node-storage.js', '/core/jobs.js'].includes(pathname)) throw failure('Not found.', 404);
  const target = path.resolve(root, '.' + pathname), relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw failure('Invalid path.');
  return target;
}
function profilesFromEnv() {
  if (process.env.XENON_PROFILES) {
    try { return JSON.parse(process.env.XENON_PROFILES); } catch { throw new Error('Invalid XENON_PROFILES JSON.'); }
  }
  return process.env.XENON_ENDPOINT ? { default: { endpoint: process.env.XENON_ENDPOINT, apiKey: process.env.XENON_API_KEY || '' } } : {};
}
async function createApp(options = {}) {
  const root = options.root || __dirname, directory = options.dataDir || process.env.XENON_DATA_DIR || path.join(root, '.xenon');
  const host = options.host || process.env.HOST || '127.0.0.1';
  const token = options.token ?? process.env.XENON_AUTH_TOKEN ?? '';
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local && token.length < 24) throw new Error('Remote binding requires XENON_AUTH_TOKEN with at least 24 characters.');
  const profiles = options.profiles || profilesFromEnv();
  for (const profile of Object.values(profiles)) {
    const url = new URL(profile.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Invalid server profile endpoint.');
  }
  const store = createStore(directory, path.join(root, 'user.json'));
  await store.load();
  const controllers = new Map(); let closing = false;
  function profileFor(id = 'default') {
    if (!Object.hasOwn(profiles, id)) throw failure('Server profile is not configured. Set XENON_ENDPOINT or XENON_PROFILES.');
    return profiles[id];
  }
  async function upstream(profile, body, signal, models = false) {
    const result = await fetch(profile.endpoint.replace(/\/$/, '') + (models ? '/models' : '/chat/completions'), {
      method: models ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(profile.apiKey ? { Authorization: 'Bearer ' + profile.apiKey } : {}) },
      ...(models ? {} : { body: JSON.stringify(body) })
    });
    if (!result.ok) { await result.body?.cancel(); throw failure(`Provider HTTP ${result.status}.`, 502); }
    return result;
  }
  const jobs = await createJobs(directory, upstream);
  function authorize(request) {
    const expectedHosts = local ? ['127.0.0.1', 'localhost', '[::1]'] : [host.includes(':') ? '[' + host + ']' : host];
    const requestHost = String(request.headers.host || '');
    if (!expectedHosts.some(h => requestHost === h || (requestHost.startsWith(h + ':') && /^\d+$/.test(requestHost.slice(h.length + 1))))) throw failure('Host is not allowed.', 403);
    if (request.headers.origin && request.headers.origin !== 'http://' + requestHost) throw failure('Cross-origin requests are not allowed.', 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw failure('Cross-site requests are not allowed.', 403);
    if (token) {
      const auth = request.headers.authorization || '';
      const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString().replace(/^[^:]*:/, '') : '';
      const a = Buffer.from(supplied), b = Buffer.from(token);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw failure('Authentication required.', 401);
    }
  }
  function json(response, value, status = 200, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); response.end(JSON.stringify(value));
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      authorize(request);
      const url = new URL(request.url, 'http://localhost'), pathname = decodeURIComponent(url.pathname), method = request.method;
      if (closing) throw failure('Server is shutting down.', 503);
      if (pathname === '/api/runtime' && method === 'GET') return json(response, { runtime: 'xenon-node', schemaVersion: 2, profiles: Object.keys(profiles) });
      if (pathname === '/api/user' && method === 'GET') { const saved = await store.load(); return json(response, saved.data, 200, { ETag: '"' + saved.version + '"' }); }
      if (pathname === '/api/user' && method === 'PUT') {
        if (!request.headers['if-match']) throw failure('If-Match is required.', 428);
        const saved = await store.save(await bodyJson(request), request.headers['if-match'].replace(/"/g, ''));
        return json(response, saved, 200, { ETag: '"' + saved.version + '"' });
      }
      if (pathname === '/api/backups' && method === 'POST') return json(response, { id: await store.backup() }, 201);
      if (pathname === '/api/backups' && method === 'GET') return json(response, await store.listBackups());
      if (pathname.startsWith('/api/backups/') && method === 'GET') {
        response.setHeader('Content-Type', 'application/json'); return response.end(await store.readBackup(pathname.slice(13)));
      }
      if (pathname === '/api/models' && method === 'GET') {
        const result = await upstream(profileFor(url.searchParams.get('profile') || 'default'), null, AbortSignal.timeout(30000), true);
        const output = await result.json();
        return json(response, { data: (Array.isArray(output.data) ? output.data : []).filter(m => typeof m.id === 'string').map(m => ({ id: m.id })) });
      }
      if (pathname === '/api/inference' && method === 'POST') {
        if (controllers.size + jobs.active() >= 2) throw failure('Two generation requests are already active.', 429);
        const data = await bodyJson(request, 2_000_000), profile = profileFor(data.profile), body = validateCompletion(data.body);
        if (controllers.size + jobs.active() >= 2) throw failure('Two generation requests are already active.', 429);
        const controller = new AbortController(), key = randomUUID(); controllers.set(key, controller);
        const timer = setTimeout(() => controller.abort(), 900000);
        const abort = () => controller.abort(); response.on('close', abort);
        try {
          const result = await upstream(profile, body, controller.signal);
          // Relay completion fields only, never diagnostic bodies or provider headers.
          if (result.headers.get('content-type')?.includes('text/event-stream')) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            let previous = '', thoughts = '';
            const output = await parse(result, update => {
              if (response.destroyed) return;
              const delta = { content: update.content.slice(previous.length), reasoning_content: update.reasoning.slice(thoughts.length) };
              previous = update.content; thoughts = update.reasoning;
              response.write('data: ' + JSON.stringify({ choices: [{ delta }], usage: update.usage }) + '\n\n');
            }, controller.signal);
            response.end('data: ' + JSON.stringify({ choices: [], usage: output.usage }) + '\n\ndata: [DONE]\n\n');
          } else {
            const output = await parse(result, null, controller.signal);
            json(response, { choices: [{ message: { content: output.content, reasoning_content: output.reasoning } }], usage: output.usage });
          }
        } finally { clearTimeout(timer); controllers.delete(key); response.off('close', abort); }
        return;
      }
      if (pathname === '/api/jobs' && method === 'GET') return json(response, jobs.list());
      if (pathname === '/api/jobs' && method === 'POST') {
        if (controllers.size + jobs.active() >= 2) throw failure('Two generation requests are already active.', 429);
        const data = await bodyJson(request, 2_000_000);
        if (controllers.size + jobs.active() >= 2) throw failure('Two generation requests are already active.', 429);
        return json(response, await jobs.start(profileFor(data.profile), validateCompletion(data.body), data.label), 202);
      }
      const jobMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(\/cancel)?$/);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]); if (!job) throw failure('Job not found.', 404);
        if (method === 'GET' && !jobMatch[2]) return json(response, job);
        if (method === 'POST' && jobMatch[2]) { jobs.cancel(job.id); return json(response, job); }
      }
      if (pathname.startsWith('/api/')) throw failure('Not found.', 404);
      if (!['GET', 'HEAD'].includes(method)) throw failure('Method not allowed.', 405);
      const filename = staticPath(root, pathname), real = await fs.realpath(filename);
      if (!real.startsWith(await fs.realpath(root) + path.sep)) throw failure('Invalid file.', 403);
      const content = await fs.readFile(filename);
      response.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf' }[path.extname(filename)] });
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.headersSent) { response.end('data: {"error":{"message":"Provider stream interrupted."}}\n\n'); return; }
      if (error.status === 401) response.setHeader('WWW-Authenticate', 'Basic realm="Xenon", charset="UTF-8"');
      json(response, { error: error.status ? error.message : error.code === 'ENOENT' ? 'Not found.' : 'Request failed. Check data and server configuration.' }, error.status || (error.code === 'ENOENT' ? 404 : 400));
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  async function listen(port = Number(process.env.PORT) || 4173) { server.listen(port, host); await once(server, 'listening'); return server.address(); }
  async function close() {
    closing = true;
    for (const controller of controllers.values()) controller.abort();
    const closed = new Promise(resolve => server.close(resolve));
    server.closeIdleConnections();
    await jobs.close(); await closed; await store.drain();
  }
  return { server, listen, close, store, jobs };
}
if (require.main === module) {
  createApp().then(async app => {
    const address = await app.listen(); console.log(`Xenon listening on http://${address.address}:${address.port}`);
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createApp, bodyJson, staticPath, validateCompletion };
