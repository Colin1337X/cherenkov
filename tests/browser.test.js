/* Optional real-Chromium integration tests. No npm dependencies or external model needed. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { once } = require('node:events');
const { createApp } = require('../server');
const { workspace } = require('./fixtures');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function launch(t) {
  const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  let executable; for (const candidate of candidates) if (await fs.stat(candidate).catch(() => false)) { executable = candidate; break; }
  if (!executable) { t.skip('Set CHROME_PATH for real-browser verification.'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xenon-chrome-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + directory, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  t.after(async () => { child.kill(); await once(child, 'exit').catch(() => {}); for (let i = 0; i < 20; i++) { try { await fs.rm(directory, { recursive: true, force: true }); break; } catch { await delay(100); } } });
  let port;
  for (let i = 0; i < 100; i++) { const content = await fs.readFile(path.join(directory, 'DevToolsActivePort'), 'utf8').catch(() => ''); if (content) { port = content.split('\n')[0]; break; } await delay(100); }
  assert(port, 'Chromium debug endpoint did not start.');
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const target = targets.find(x => x.type === 'page'); assert(target);
  const socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  t.after(() => socket.close()); let id = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const promise = pending.get(message.id); pending.delete(message.id); if (message.error) promise.reject(new Error(message.error.message)); else promise.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + message.params.exceptionDetails.exception?.description);
    if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'beforeunload') send('Page.handleJavaScriptDialog', { accept: true });
  });
  function send(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); }); }
  await send('Runtime.enable'); await send('Page.enable');
  async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
  async function navigate(url) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      const state = await evaluate("document.getElementById('terminal-output')?.textContent || ''"); if (state.includes('Xenon ready.')) return;
      const warning = await evaluate("document.getElementById('storage-warning')?.textContent || ''"); if (warning.includes('Startup failed')) throw new Error(warning);
      await delay(50);
    }
    throw new Error('Xenon did not initialize: ' + errors.join('\n'));
  }
  return { send, evaluate, navigate, errors };
}
test('raw HTML and Node UI: legacy commands, autosave, safe preview, conflicts, undo, Bible, import, reload, mobile', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const { evaluate: evaluate, navigate, send, errors } = browser;
  const mock = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
    if (request.url.endsWith('/models')) { response.setHeader('Content-Type', 'application/json'); return response.end('{"data":[{"id":"mock"}]}'); }
    let raw = ''; for await (const chunk of request) raw += chunk;
    response.setHeader('Content-Type', 'text/event-stream');
    if (JSON.parse(raw).model === 'slow') return response.write('data: {"choices":[{"delta":{"content":"Partial generation"}}]}\n\n');
    response.end('data: {"choices":[{"delta":{"content":"A revised garden. <img src=x onerror=alert(1)>","reasoning_content":"Plan"}}]}\n\ndata: {"usage":{"completion_tokens":9}}\n\ndata: [DONE]\n\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); t.after(() => new Promise(r => mock.close(r)));
  const endpoint = 'http://127.0.0.1:' + mock.address().port + '/v1';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xenon-browser-server-'));
  const app = await createApp({ dataDir: directory, profiles: { default: { endpoint, apiKey: 'server-key-never-browser' } } });
  const address = await app.listen(0); t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const urls = [pathToFileURL(path.resolve(__dirname, '../index.html')).href, 'http://127.0.0.1:' + address.port];
  for (const [mode, url] of urls.entries()) {
    await navigate(url);
    assert.equal(await evaluate('workspaceStorage.mode === "node"'), mode === 1);
    await evaluate("mainEditor.value = 'Unshelved opening paragraph.'; mainEditor.dispatchEvent(new Event('input')); flushEditor()");
    assert.equal(await evaluate('xenonData.scratch'), 'Unshelved opening paragraph.');
    await evaluate(`mergeWorkspace(${JSON.stringify({ ...workspace(), preferences: 'Terse prose.', scratch: 'Imported scratchpad.' })})`);
    assert.equal(await evaluate("byId('writing-preferences').value"), 'Terse prose.');
    assert.equal(await evaluate("xenonData.scratch.includes('Unshelved opening paragraph.') && xenonData.scratch.includes('Imported scratchpad.')"), true);
    await evaluate("tokenizeCommand('load /stories/book/chapter/scene')");
    assert.equal(await evaluate('mainEditor.value'), 'Mara walked into the garden.');
    await evaluate("mainEditor.value = 'Mara walked into the bright garden.'; mainEditor.dispatchEvent(new Event('input', { bubbles: true })); flushEditor()");
    await evaluate("tokenizeCommand('generate --dry-run --missing /stories/book')");
    assert((await evaluate('terminalOutput.textContent')).includes('No scenes to generate.'));
    await evaluate("tokenizeCommand('load /stories/book')"); assert.equal(await evaluate('mainEditor.readOnly'), true);
    await evaluate("tokenizeCommand('load /stories/book/chapter/scene')");
    await evaluate("saveBible({book:'/stories/book', type:'character',name:'Mara',status:'canon',description:'A gardener',metadata:{alive:false},references:['scene-1']})");
    assert.equal(await evaluate('checkContinuity().length'), 1);
    await evaluate(`endpointInput.value=${JSON.stringify(endpoint)}; modelInput.value='mock'; byId('use-proxy').checked=${mode === 1}; mainEditor.setSelectionRange(0, mainEditor.value.length); runWriting(captureOperation('rewrite', 'Clarity'))`);
    assert((await evaluate("byId('generation-preview').value")).includes('A revised garden.'));
    assert.equal(await evaluate("document.querySelector('#preview-panel img')"), null);
    const before = await evaluate('mainEditor.value');
    await evaluate("acceptCandidate()"); assert((await evaluate('mainEditor.value')).includes('A revised garden.'));
    await evaluate('undoEdit()'); assert.equal(await evaluate('mainEditor.value'), before);
    await evaluate("runWriting(captureOperation('rewrite'))");
    await evaluate("mainEditor.value += ' Extra edit.'; mainEditor.dispatchEvent(new Event('input')); flushEditor()");
    assert.match(await evaluate("acceptCandidate().then(() => 'bad', e => e.message)"), /changed/);
    await evaluate("tokenizeCommand('mv /stories/book/chapter/scene /stories/book/chapter/renamed')");
    assert.equal(await evaluate('findRecord("scene-1").path'), '/stories/book/chapter/renamed');
    await evaluate("tokenizeCommand('tracker new revision /stories/book')"); assert.equal(await evaluate("trackerDefinitions.some(t => t.name === 'revision')"), true);
    await evaluate(`mergeWorkspace(${JSON.stringify(workspace())})`);
    assert.equal(await evaluate("recordArray.some(r => r.path === '/stories-import/book/chapter/scene')"), true);
    assert.equal(await evaluate("recordArray.some(r => r.path === '/stories/book/chapter/renamed')"), true);
    assert.equal(await evaluate("JSON.stringify(cleanExport(buildUserData())).includes('server-key-never-browser')"), false);
    await evaluate("tokenizeCommand('mkdir -p /cli/book/chapter')");
    await evaluate("tokenizeCommand('touch /cli/book/chapter/first')");
    await evaluate("tokenizeCommand('touch /cli/book/chapter/second')");
    await evaluate(`endpointInput.value=${JSON.stringify(endpoint)}; modelInput.value='mock'; byId('use-proxy').checked=${mode === 1}`);
    await evaluate("tokenizeCommand('generate -r --missing /cli/book')");
    assert.equal(await evaluate("getScenesUnder('/cli/book').filter(r => r.content && r.lastGeneration.reasoning === 'Plan' && r.generationSettings).length"), 2, await evaluate('terminalOutput.textContent'));
    assert.equal(await evaluate("new Set(getScenesUnder('/cli/book').map(r => r.path)).size"), 2);
    await evaluate("tokenizeCommand('rm -rf /cli/book')");
    assert.equal(await evaluate("getScenesUnder('/cli/book').length"), 0);
    assert.equal(await evaluate("xenonData.trash.filter(r => r.type === 'scene').length"), 2);
    await evaluate("tokenizeCommand('load /stories/book/chapter/renamed')");
    const preserved = await evaluate('mainEditor.value');
    await evaluate("modelInput.value = 'slow'; globalThis.cancellationTest = tokenizeCommand('generate .'); 'started'");
    for (let i = 0; i < 100 && !await evaluate("mainEditor.value.startsWith('Partial generation')"); i++) await delay(10);
    assert.equal(await evaluate("mainEditor.value.startsWith('Partial generation')"), true);
    await evaluate('cancelGeneration(); globalThis.cancellationTest');
    assert.equal(await evaluate('mainEditor.value'), preserved);
    assert.equal(await evaluate("findRecord('/stories/book/chapter/renamed').content"), preserved);
    assert.equal(await evaluate('selectedCandidate().content'), 'Partial generation');
    await navigate(url);
    assert.equal(await evaluate("findRecord('/stories/book/chapter/renamed').content.endsWith('Extra edit.')"), true);
    if (mode) {
      const remote = await (await fetch(url + '/api/user')).json(); assert(remote.records.some(r => r.path.endsWith('/renamed')));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await fs.mkdir(path.resolve(__dirname, '../test-results'), { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.resolve(__dirname, '../test-results/mobile.png'), Buffer.from(shot.data, 'base64'));
      await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
      const desktop = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.resolve(__dirname, '../test-results/desktop.png'), Buffer.from(desktop.data, 'base64'));
    }
  }
  assert.deepEqual(errors, []);
});
