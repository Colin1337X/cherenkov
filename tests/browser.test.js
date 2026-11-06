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
      const state = await evaluate("document.getElementById('terminal-output')?.textContent || ''"); if (state.includes('Xenon ready.') || state.includes('Cherenkov ready.')) return;
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
  const setMode = mode => evaluate(`(() => {
    const select = byId('workspace-mode');
    select.value = ${JSON.stringify(mode)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  for (const [mode, url] of urls.entries()) {
    await navigate(url);
    assert.equal(await evaluate('workspaceStorage.mode === "node"'), mode === 1);
    assert.equal(await evaluate('terminalContent.hidden'), true);
    await evaluate("byId('focus-mode').click(); mainEditor.focus(); mainEditor.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }))");
    assert.equal(await evaluate('document.activeElement === commandInput && !terminalContent.hidden'), true);
    await evaluate("commandInput.value = 'pwd'; commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    for (let i = 0; i < 100 && await evaluate('commandInput.disabled'); i++) await delay(10);
    assert.equal(await evaluate("commandHistory.at(-1) === 'pwd' && document.activeElement === commandInput"), true);
    await evaluate("commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    assert.equal(await evaluate("terminalContent.hidden && document.activeElement === mainEditor && document.body.classList.contains('focus-mode')"), true);
    await evaluate("byId('open-creative-controls').focus(); byId('open-creative-controls').click()");
    assert.equal(await evaluate("byId('creative-controls').matches(':modal') && document.activeElement === byId('length')"), true);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate("!byId('creative-controls').open && document.activeElement === byId('open-creative-controls') && document.body.classList.contains('focus-mode')"), true);
    await evaluate("byId('focus-mode').click()");
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
    const pendingCandidate = await evaluate('selectedCandidate().content');
    await setMode('cherenkov');
    assert.equal(await evaluate(`(() => {
      const hidden = id => getComputedStyle(byId(id)).display === 'none';
      return isCherenkovMode() && ['writing-tools', 'context-panel', 'project-library', 'revision-panel'].every(hidden)
        && !hidden('explorer') && !hidden('config-box') && byId('preview-panel').hidden
        && mainEditor.value.endsWith('Extra edit.');
    })()`), true);
    await evaluate("tokenizeCommand('xenon help')");
    assert.match(await evaluate('terminalOutput.textContent'), /Choose Xenon in Workspace mode/);
    assert.equal(await evaluate("commandInput.value = 'xe'; commandInput.setSelectionRange(2, 2); completeTerminalInput(); commandInput.value"), 'xe');
    await evaluate("commandInput.value = ''");
    await evaluate(`(async () => {
      byId('dock-creative-controls').click();
      const length = byId('length');
      length.value = '63';
      length.dispatchEvent(new Event('input', { bubbles: true }));
      byId('close-creative-controls').click();
      await flushEditor();
    })()`);
    assert.equal(await evaluate("currentRecord.creativeControls.length"), '63');
    await setMode('xenon');
    assert.equal(await evaluate("!byId('preview-panel').hidden && getComputedStyle(byId('writing-tools')).display !== 'none'"), true);
    assert.equal(await evaluate('selectedCandidate().content'), pendingCandidate);
    await evaluate("tokenizeCommand('mv /stories/book/chapter/scene /stories/book/chapter/renamed')");
    assert.equal(await evaluate('findRecord("scene-1").path'), '/stories/book/chapter/renamed');
    await evaluate("tokenizeCommand('tracker new revision /stories/book')"); assert.equal(await evaluate("trackerDefinitions.some(t => t.name === 'revision')"), true);
    await evaluate(`mergeWorkspace(${JSON.stringify(workspace())})`);
    assert.equal(await evaluate("recordArray.some(r => r.path === '/stories-import/book/chapter/scene')"), true);
    assert.equal(await evaluate("recordArray.some(r => r.path === '/stories/book/chapter/renamed')"), true);
    assert.equal(await evaluate("JSON.stringify(cleanExport(buildUserData())).includes('server-key-never-browser')"), false);
    await setMode('cherenkov');
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
    assert.equal(await evaluate("byId('preview-panel').hidden"), false);
    await navigate(url);
    assert.equal(await evaluate("isCherenkovMode() && byId('workspace-mode').value === 'cherenkov' && byId('workspace-name').textContent === 'cherenkov'"), true);
    assert.equal(await evaluate("findRecord('/stories/book/chapter/renamed').content.endsWith('Extra edit.')"), true);
    if (mode) {
      const remote = await (await fetch(url + '/api/user')).json(); assert(remote.records.some(r => r.path.endsWith('/renamed')));
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 420, deviceScaleFactor: 1, mobile: false });
      assert.equal(await evaluate(`(() => {
        const editor = byId('workspace-editor').getBoundingClientRect();
        const tools = document.querySelector('.sidebar').getBoundingClientRect();
        return editor.right <= tools.left && tools.width > 0
          && document.documentElement.scrollHeight === document.documentElement.clientHeight;
      })()`), true);
    }
    await setMode('xenon');
    if (mode) {
      await evaluate(`(() => {
        byId('config-box').open = true;
        byId('revision-panel').open = true;
        byId('editor-title').textContent = 'long-unbroken-scene-name'.repeat(12);
        byId('revision-before').textContent = 'old-text'.repeat(40);
        byId('revision-after').textContent = 'new-text'.repeat(40);
      })()`);
      for (const [width, height, layout] of [
        [280, 480, 'stack'], [390, 844, 'stack'], [768, 1024, 'tablet'],
        [844, 390, 'tablet'], [1024, 600, 'side'], [1280, 420, 'wide'], [1600, 1000, 'wide']
      ]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
        const measured = await evaluate(`(() => {
          const editor = byId('workspace-editor').getBoundingClientRect();
          const library = byId('project-library').getBoundingClientRect();
          const tools = document.querySelector('.sidebar').getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            layout: library.right <= editor.left && editor.right <= tools.left ? 'wide'
              : editor.right <= tools.left && editor.bottom <= library.top ? 'side'
              : editor.bottom <= library.top && library.right <= tools.left ? 'tablet'
              : editor.bottom <= library.top && library.bottom <= tools.top ? 'stack' : 'overlap'
          };
        })()`);
        assert.deepEqual(measured, { overflow: 0, layout }, `${width}×${height}`);
        if (layout === 'wide') {
          assert.equal(await evaluate(`(() => {
            const workspace = document.querySelector('.workspace');
            const tools = document.querySelector('.sidebar');
            tools.scrollTop = tools.scrollHeight;
            return document.documentElement.scrollHeight === document.documentElement.clientHeight
              && document.querySelector('.workspace-footer').getBoundingClientRect().bottom <= innerHeight
              && [...workspace.children].every(pane => pane.getBoundingClientRect().bottom <= innerHeight)
              && tools.scrollTop > 0 && scrollY === 0;
          })()`), true, `${width}×${height} workspace fits the viewport and tools scroll independently`);
        }
      }
      await evaluate("byId('config-box').open = false; byId('revision-panel').open = false; document.querySelector('.sidebar').scrollTop = 0; renderUiState()");
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 480, deviceScaleFactor: 1, mobile: true });
      await evaluate("window.scrollTo(0, document.body.scrollHeight / 2); byId('dock-creative-controls').focus({ preventScroll: true })");
      assert.equal(await evaluate(`(() => {
        const launcher = byId('dock-creative-controls');
        const bounds = launcher.getBoundingClientRect();
        return scrollY > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
          && launcher.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
      })()`), true);
      await evaluate("byId('dock-creative-controls').click()");
      assert.equal(await evaluate(`(() => {
        const dialog = byId('creative-controls').getBoundingClientRect();
        const fields = document.querySelector('.creative-fields');
        fields.scrollTop = fields.scrollHeight;
        const close = byId('close-creative-controls').getBoundingClientRect();
        return dialog.top >= 0 && dialog.bottom <= innerHeight && dialog.right <= innerWidth
          && fields.scrollTop > 0 && close.top >= 0 && close.bottom <= innerHeight;
      })()`), true);
      await evaluate("byId('close-creative-controls').click()");
      assert.equal(await evaluate("document.activeElement === byId('dock-creative-controls')"), true);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      await evaluate("document.querySelector('.workspace-nav a[href=\"#writing-tools\"]').click()");
      assert.equal(await evaluate(`(() => {
        const navigation = document.querySelector('.workspace-nav').getBoundingClientRect();
        const tools = byId('writing-tools').getBoundingClientRect();
        return document.activeElement === byId('writing-tools') && navigation.bottom <= tools.top && tools.top < innerHeight;
      })()`), true);
      assert.equal(await evaluate(`(() => {
        const toggle = byId('toggle-terminal');
        const initialTop = toggle.getBoundingClientRect().top;
        window.scrollTo(0, document.body.scrollHeight / 2);
        const { top, bottom, left, right } = toggle.getBoundingClientRect();
        return scrollY > 0 && top === initialTop && bottom <= innerHeight
          && toggle.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
      })()`), true);
      await evaluate("byId('toggle-terminal').click()");
      assert.equal(await evaluate(`(() => {
        const panel = terminalContent.getBoundingClientRect();
        return !terminalContent.hidden && panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight
          && document.activeElement === commandInput;
      })()`), true);
      await evaluate("byId('toggle-terminal').click(); window.scrollTo(0, 0)");
      await fs.mkdir(path.resolve(__dirname, '../test-results'), { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.resolve(__dirname, '../test-results/mobile.png'), Buffer.from(shot.data, 'base64'));
      await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
      const desktop = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.resolve(__dirname, '../test-results/desktop.png'), Buffer.from(desktop.data, 'base64'));
    }
  }
  assert.deepEqual(errors, []);
});

test('terminal-only writing, configuration, review and recovery in both runtimes', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const { evaluate, navigate, send, errors } = browser;
  const mock = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    if (request.method === 'OPTIONS') return response.writeHead(204).end();
    if (request.url === '/v1/models') return response.setHeader('Content-Type', 'application/json').end('{"data":[{"id":"terminal-model"}]}');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const requestBody = JSON.parse(raw);
    const operation = JSON.parse(requestBody.messages.at(-1).content).operation;
    const content = operation === 'extract'
      ? JSON.stringify([{ type: 'location', name: 'Observatory', description: 'A hilltop observatory.' }])
      : 'Terminal draft.';
    response.setHeader('Content-Type', 'text/event-stream');
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content, reasoning_content: 'Terminal plan' } }] })}\n\n`);
    if (requestBody.model !== 'slow') response.end('data: [DONE]\n\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  t.after(() => { mock.closeAllConnections(); return new Promise(resolve => mock.close(resolve)); });
  const endpoint = 'http://127.0.0.1:' + mock.address().port + '/v1';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xenon-cli-server-'));
  const app = await createApp({ dataDir: directory, profiles: { default: { endpoint } } });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });

  async function enter(command) {
    const offset = await evaluate('terminalOutput.textContent.length');
    await evaluate(`commandInput.value = ${JSON.stringify(command)}; commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
    return offset;
  }
  async function result(offset) {
    for (let i = 0; i < 200 && await evaluate('commandInput.disabled'); i++) await delay(10);
    assert.equal(await evaluate('commandInput.disabled'), false, 'Terminal command did not finish.');
    return evaluate(`terminalOutput.textContent.slice(${offset})`);
  }
  async function run(command) {
    const output = await result(await enter(command));
    assert.doesNotMatch(output, /^Error:/m, command);
    return output;
  }
  async function prompt(command, value, selector = 'textarea') {
    const offset = await enter(command);
    const query = JSON.stringify('.terminal-prompt ' + selector);
    for (let i = 0; i < 100 && !await evaluate(`Boolean(document.querySelector(${query}))`); i++) await delay(10);
    await evaluate(`document.querySelector(${query}).value = ${JSON.stringify(value)}; document.querySelector('.terminal-prompt').requestSubmit()`);
    const output = await result(offset);
    assert.doesNotMatch(output, /^Error:/m, command);
    return output;
  }

  const urls = [pathToFileURL(path.resolve(__dirname, '../index.html')).href, 'http://127.0.0.1:' + address.port];
  for (const [node, url] of urls.entries()) {
    await navigate(url);
    await evaluate("byId('toggle-terminal').click()");
    assert.match(await run('help'), /controls show/);
    assert.match(await prompt('import --paste', JSON.stringify(workspace())), /Imported 4 records/);
    await run('load /stories/book/chapter/scene');
    assert.match(await run('cat'), /Mara walked/);
    await run('write ' + JSON.stringify('First line\nSecond "quoted" line.'));
    await run('append "--end"');
    assert.match(await run('cat'), /First line\nSecond "quoted" line\.\n--end/);
    await prompt('edit', 'Mara found the observatory.\nThe garden was empty.');
    assert.match(await run('find garden'), /Selection \d+–\d+\ngarden/);
    await run('replace garden greenhouse');
    await run('undo');
    assert.match(await run('cat'), /garden/);
    await run('redo');
    assert.match(await run('cat'), /greenhouse/);
    assert.match(await run('revision compare 1'), /--- Current ---\nMara found/);
    await run('tracker set status "in review"');
    assert.match(await run('tracker get status'), /in review/);
    await run('controls set length 72');
    assert.match(await run('controls show'), /length = "72"/);
    await run('controls reset length');
    assert.match(await run('controls show'), /length = "55" \(inherited\)/);

    if (node) {
      assert.match(await run('profile servers'), /default/);
      await run('config set proxy on');
    } else await run(`config set endpoint ${endpoint}`);
    const unsafe = await result(await enter('config set api-key misplaced-secret'));
    assert.match(unsafe, /^Error: Unknown setting/m);
    assert.doesNotMatch(unsafe, /misplaced-secret/);
    assert.doesNotMatch(await prompt('config key', 'private-test-key', 'input[type=password]'), /private-test-key/);
    assert.match(await run('config show'), /api-key = \(set\)/);
    assert.doesNotMatch(await evaluate('terminalOutput.textContent + commandHistory.join(" ")'), /private-test-key|misplaced-secret/);
    assert.match(await run('config models'), /terminal-model/);
    await run('config set model terminal-model');
    await run('config set timeout 29');
    await run('profile save "Terminal profile"');
    assert.match(await run('profile list'), /Terminal profile/);

    const added = await run('xenon bible add character Mara');
    const entry = added.match(/Added Mara · (\S+)/)[1];
    await run('xenon bible set Mara status canon');
    await run('xenon bible set Mara description "Works at the observatory"');
    assert.match(await run('xenon bible show Mara'), /"status": "canon"/);
    await run('xenon context budget 2400');
    assert.match(await run(`xenon context exclude ${entry}`), /omitted · Bible: Mara/);
    assert.match(await run(`xenon context pin ${entry}`), /included · Bible: Mara/);
    assert.match(await run('xenon context show'), /Works at the observatory/);
    await run('xenon set operation rewrite');
    await run('xenon set count 2');
    await run('select all');
    const output = await run('xenon run --selection "Keep the meaning"');
    assert.match(output, /Candidate 1\nTerminal draft\./);
    assert.match(await run('preview list'), /2 · 15 characters/);
    assert.match(await run('preview reasoning 1'), /Terminal plan/);
    await run('preview accept 1');
    assert.match(await run('cat'), /Terminal draft\./);
    await run('xenon extract');
    assert.match(await run('xenon bible candidates'), /Observatory/);
    assert.match(await run('xenon bible accept 1'), /as a draft/);
    assert.match(await run('xenon bible list'), /draft Observatory/);

    if (node) {
      const started = await run('xenon jobs start draft');
      const id = started.match(/Started job (\S+)\./)[1];
      let job;
      for (let i = 0; i < 100; i++) {
        job = await run(`xenon jobs show ${id}`);
        if (job.includes('completed')) break;
        await delay(20);
      }
      assert.match(job, /completed\nTerminal draft\./);
      await run(`xenon jobs review ${id}`);
      assert.match(await run('preview show'), /Terminal draft/);
      await run('preview append');
    }
    await run('xenon set model slow');
    const offset = await enter('xenon run');
    for (let i = 0; i < 100 && !await evaluate(`terminalOutput.textContent.slice(${offset}).includes('Terminal draft.')`); i++) await delay(10);
    assert.equal(await evaluate('commandInput.disabled'), true);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67 });
    assert.match(await result(offset), /Generation cancelled/);
    await run('preview reject');
    await run('backup create');
    const backups = await run('backup list');
    assert.doesNotMatch(backups, /No stored backups/);
    if (node) {
      const backupId = backups.split('\n').find(line => /^\d+-[a-f0-9-]+\.json$/.test(line));
      assert(backupId);
      assert.match(await run(`backup recover ${backupId}`), /Existing records preserved/);
      await run('load /stories/book/chapter/scene');
      const downloadPath = path.join(directory, 'browser-downloads');
      await fs.mkdir(downloadPath);
      await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
      assert.match(await run('export /stories/book'), /Downloaded workspace export/);
      const file = path.join(downloadPath, 'xenon-workspace.json');
      let exported;
      for (let i = 0; i < 100 && !exported; i++) {
        exported = await fs.readFile(file, 'utf8').catch(() => null);
        if (!exported) await delay(10);
      }
      assert(exported);
      assert.doesNotMatch(exported, /private-test-key/);
      const data = JSON.parse(exported);
      assert(data.records.some(record => record.content.includes('Terminal draft.')));
      assert(data.records.every(record => !record.path.startsWith('/stories-import')));
    }
    await run('mode cherenkov');
    assert.match(await run('mode'), /Pure Cherenkov/);
    assert.match(await run('cat'), /Terminal draft\./);
    assert.match(await run("css set ':root { --radius: 9px; }'"), /Custom CSS applied/);
    assert.equal(await evaluate("getComputedStyle(byId('workspace-editor')).borderTopLeftRadius"), '9px');
    const css = ':root {\n  --radius: 7px;\n}\n/* </style><script>window.customCssRan = true</script> */';
    assert.match(await prompt('css edit', css), /Custom CSS applied/);
    assert.equal(await evaluate("getComputedStyle(byId('workspace-editor')).borderTopLeftRadius"), '7px');
    assert.equal(await evaluate('Boolean(window.customCssRan)'), false);
    await run('mode xenon');
    await navigate(url);
    await evaluate("byId('toggle-terminal').click()");
    assert.match(await run('config show'), /timeout = "29"/);
    assert.match(await run('profile list'), /Terminal profile/);
    assert.equal(await evaluate("getComputedStyle(byId('workspace-editor')).borderTopLeftRadius"), '7px');
    assert.match(await run('css show'), /--radius: 7px/);
    const safeUrl = new URL(url);
    safeUrl.searchParams.set('safe-css', '1');
    await navigate(safeUrl.href);
    await evaluate("byId('toggle-terminal').click()");
    assert.equal(await evaluate("getComputedStyle(byId('workspace-editor')).borderTopLeftRadius"), '18px');
    assert.match(await run('css show'), /--radius: 7px/);
    assert.match(await run('css reset'), /Safe CSS mode is active/);
    await navigate(url);
    await evaluate("byId('toggle-terminal').click()");
    assert.equal(await evaluate("getComputedStyle(byId('workspace-editor')).borderTopLeftRadius"), '18px');
    assert.match(await run('css show'), /No custom CSS saved/);
    await evaluate("byId('custom-css').value = ':root { --radius: 6px; }'; byId('custom-css-form').requestSubmit()");
    assert.equal(await evaluate("getComputedStyle(byId('workspace-editor')).borderTopLeftRadius"), '6px');
    await evaluate("byId('reset-custom-css').click()");
    assert.match(await run('css show'), /No custom CSS saved/);
  }
  assert.deepEqual(errors, []);
});
