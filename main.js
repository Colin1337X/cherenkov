// Start the application after the deferred script has access to the page.
// Configuration is loaded first, then OPFS records are loaded, and finally
// the terminal listener is attached so commands always have storage ready.
async function init() {
    saveConfigButton.addEventListener('click', saveConfig);
    getModelsButton.addEventListener('click', getModels);
    availableModelsSelect.addEventListener('change', syncModelSelect);
    globalCreativeControls = getDefaultCreativeControls();
    setupCreativeControls();
    loadConfig();
    showCreativeControls(globalCreativeControls);
    await getModels();
    opfsRoot = await navigator.storage.getDirectory();
    recordDirectory = await getRecordDirectory();
    await refreshRecords();
    renderUiState();
    mainEditor.addEventListener('input', () => {
      setSaveStatus('unsaved');
      renderUiState();
    });
    resetCreativeControlsButton.addEventListener('click', resetCreativeControls);
    commandInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = commandInput.value.trim();
        if (!command) return;
        commandInput.value = '';
        commandInput.disabled = true;
        setTerminalState('working');
        try {
          await tokenizeCommand(command);
        } catch (error) {
          console.error('Command failed:', error);
          printTerminal(`Error: ${error.message}`);
        } finally {
          commandInput.disabled = false;
          setTerminalState('ready');
          commandInput.focus();
        }
      }
    });
}

const commandInput = document.getElementById("terminal-input");
const mainEditor = document.getElementById("main-editor");
const terminalOutput = document.getElementById("terminal-output");
const currentPathElement = document.getElementById("current-path");
const editorStatusElement = document.getElementById("editor-status");
const editorTitleElement = document.getElementById("editor-title");
const saveStatusElement = document.getElementById("save-status");
const terminalStateElement = document.getElementById("terminal-state");
const resetCreativeControlsButton = document.getElementById("reset-creative-controls");
const endpointInput = document.getElementById("openai-endpoint");
const apiKeyInput = document.getElementById("openai-api-key");
const modelInput = document.getElementById("openai-model");
const systemPromptInput = document.getElementById("system-prompt");
const availableModelsSelect = document.getElementById("available-models");
const saveConfigButton = document.getElementById("save-config-button");
const getModelsButton = document.getElementById("get-models-button");
const creativeControlIds = [
  'length',
  'pacing',
  'chaos',
  'dialogue-share',
  'tension',
  'premise-corehook',
  'style-guide',
  'world-rules-constraints',
  'character-ledger-and-arcs'
];

// These values are shared by every terminal command. In particular,
// currentPath must live outside executeCommand() so it survives between
// commands in the same way a shell's working directory does.
let recordDirectory;
let recordArray = [];
let currentPath = '/';
let currentRecord = null;
let globalCreativeControls = {};
let creativeOverrideIds = new Set();


// Turn raw terminal text into one small command object. Flags are kept
// separate from positional arguments, and quoted values remain one argument.
async function tokenizeCommand(command) {
  if (command === '') {
    return null;
  }
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(part => part.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) || [];
  const flags = [];
  const args = [];
  for (const part of parts.slice(1)) {
    if (part.startsWith('--')) flags.push(part);
    else if (/^-[^-]+$/.test(part)) flags.push(...part.slice(1).split('').map(flag => '-' + flag));
    else args.push(part);
  }
  return executeCommand({
    cmd: parts[0].toLowerCase(),
    flags,
    args
  });
}

// Dispatch one parsed command. Each branch returns after it finishes so the
// handlers stay independent instead of accidentally nesting inside each other.
async function executeCommand({ cmd, flags, args }) {
  const [inputdir, outputdir] = args;

  // A destination can be one scene or any container above it. Generation is
  // deliberately sequential so each completed scene is saved before the next
  // request begins. Filters can select missing or stale scenes, --dry-run only
  // prints the queue, and --force deliberately ignores the filters.
  if (cmd === 'generate' || cmd === 'gen' || cmd === 'g') {
    const destination = resolvePath(inputdir || currentPath);
    let scenes = getScenesUnder(destination);
    if (hasFlag(flags, '--force', '-f')) {
      // Force deliberately keeps the full queue, even when filter flags exist.
    } else if (hasFlag(flags, '--missing', '-m')) {
      scenes = scenes.filter(record => !record.content?.trim());
    } else if (hasFlag(flags, '--stale', '-s')) {
      scenes = scenes.filter(record => record.stale === true);
    }
    if (!scenes.length) {
      printTerminal('No scenes to generate.');
      return;
    }
    if (hasFlag(flags, '--dry-run', '-n')) {
      printTerminal(`Would generate ${scenes.length} scene${scenes.length === 1 ? '' : 's'}:\n${scenes.map(record => record.path).join('\n')}`);
      return;
    }
    for (const [index, record] of scenes.entries()) {
      printTerminal(`Generating ${index + 1}/${scenes.length}: ${record.path}`);
      const controls = resolveCreativeControls(record);
      const params = getGenerationParams(controls);
      const content = await openaiGen(resolveSceneContext(record, controls), params);
      if (content === null) {
        printTerminal(`Generation failed: ${record.path}`);
        return;
      }
      record.content = content;
      record.updatedAt = new Date().toISOString();
      record.lastGeneration = { controls, params, generatedAt: record.updatedAt };
      await saveRecord(recordDirectory, record);
      if (currentRecord?.id === record.id) {
        mainEditor.value = content;
        setSaveStatus('saved');
      }
    }
    await refreshRecords();
    printTerminal(`Generated ${scenes.length} scene${scenes.length === 1 ? '' : 's'}.`);
    return;
  }

  if (cmd === 'save' || cmd === 's') {
    if (!currentRecord) {
      printTerminal('Load or create a scene before saving.');
      return;
    }
    currentRecord.content = mainEditor.value;
    currentRecord.creativeControls = readCreativeOverrides();
    currentRecord.updatedAt = new Date().toISOString();
    await saveRecord(recordDirectory, currentRecord);
    await refreshRecords();
    setSaveStatus('saved');
    printTerminal(`Saved ${currentRecord.path}.`);
    return;
  }

  if (cmd === 'load' || cmd === 'l') {
    const target = inputdir || currentPath;
    if (resolvePath(target) === '/') {
      currentRecord = null;
      currentPath = '/';
      mainEditor.value = '';
      creativeOverrideIds.clear();
      showCreativeControls(globalCreativeControls);
      setSaveStatus('ready');
      printTerminal('Loaded global creative defaults.');
      return;
    }
    const record = findRecord(target);
    if (!record) {
      printTerminal(`Record not found: ${target}`);
      return;
    }
    currentRecord = record;
    currentPath = record.path;
    mainEditor.value = record.content || '';
    creativeOverrideIds = new Set(Object.keys(record.creativeControls || {}));
    showCreativeControls(resolveCreativeControls(record), creativeOverrideIds);
    setSaveStatus('saved');
    printTerminal(`Loaded ${record.path}.`);
    return;
  }

  if (cmd === 'delete' || cmd === 'del' || cmd === 'rm' || cmd === 'd') {
    const record = findRecord(inputdir || currentPath);
    if (!record) {
      if (!hasFlag(flags, '--force', '-f')) printTerminal(`Record not found: ${inputdir || currentPath}`);
      return;
    }
    if (record.type !== 'scene' && !hasFlag(flags, '--recursive', '-r')) {
      printTerminal(`Use --recursive or -r to delete ${record.path} and its contents.`);
      return;
    }
    // Removing a container also removes every record below its virtual path.
    const records = record.type === 'scene'
      ? [record]
      : recordArray.filter(item => item.path === record.path || isPathInside(item.path, record.path));
    for (const item of records) await deleteRecord(recordDirectory, item.id);
    if (records.some(item => item.id === currentRecord?.id)) {
      currentRecord = null;
      currentPath = '/';
      mainEditor.value = '';
      creativeOverrideIds.clear();
      showCreativeControls(globalCreativeControls);
      setSaveStatus('ready');
    }
    await refreshRecords();
    printTerminal(`Deleted ${records.length} record${records.length === 1 ? '' : 's'}.`);
    return;
  }

  if (cmd === 'list' || cmd === 'ls') {
    const scope = resolvePath(inputdir || currentPath);
    const records = hasFlag(flags, '--recursive', '-r')
      ? recordArray.filter(record => scope === '/' || record.path === scope || isPathInside(record.path, scope))
      : recordArray.filter(record => record.parentPath === scope || (record.path === scope && record.type === 'scene'));
    printTerminal(records.length ? records.map(formatRecord).join('\n') : 'No records.');
    return;
  }

  if (cmd === 'clear' || cmd === 'clr' || cmd === 'cls') {
    terminalOutput.value = '';
    return;
  }

  if (cmd === 'help' || cmd === 'h') {
    printTerminal(
      'Commands:\n' +
      'ls [-r|--recursive] [path]\n' +
      'mkdir [-p|--parents] <path>\n' +
      'touch <scene>\n' +
      'load <path|id> | save | pwd | cd <path>\n' +
      'mv [-f|--force] <source> <destination>\n' +
      'rm [-r|--recursive] [-f|--force] <path|id> (combined: -rf)\n' +
      'generate [-m|--missing] [-s|--stale] [-f|--force] [-n|--dry-run] [path]\n' +
      'clear | help'
    );
    return;
  }

  if (cmd === 'move' || cmd === 'mv') {
    if (!inputdir || !outputdir) {
      printTerminal('Usage: mv <source> <destination>');
      return;
    }
    const moved = await moveRecord(resolvePath(inputdir), resolvePath(outputdir), hasFlag(flags, '--force', '-f'));
    if (moved) printTerminal(`Moved ${inputdir} to ${outputdir}.`);
    return;
  }

  if (cmd === 'new' || cmd === 'touch') {
    if (!inputdir) return printTerminal('Usage: touch <path>');
    await createRecord(resolvePath(inputdir), 'scene');
    return;
  }

  if (cmd === 'mkdir') {
    if (!inputdir) return printTerminal('Usage: mkdir <path>');
    const path = resolvePath(inputdir);
    if (!inferType(path) || inferType(path) === 'scene') return printTerminal('mkdir can create folders, books, and chapters. Use touch for scenes.');
    if (hasFlag(flags, '--parents', '-p')) {
      const parts = path.split('/').filter(Boolean);
      for (let index = 1; index <= parts.length; index++) {
        const parent = '/' + parts.slice(0, index).join('/');
        if (!findRecord(parent)) await createRecord(parent);
      }
    } else {
      await createRecord(path);
    }
    return;
  }

  if (cmd === 'pwd') {
    printTerminal(currentPath);
    return;
  }

  if (cmd === 'cd') {
    const path = resolvePath(inputdir || '/');
    if (path !== '/' && !findRecord(path)) return printTerminal(`Path not found: ${path}`);
    currentPath = path;
    printTerminal(currentPath);
    return;
  }

  printTerminal(`Unknown command: ${cmd}`);
}

function printTerminal(message) {
  terminalOutput.value += message + '\n';
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  renderUiState();
}

// Keep the small status areas in sync without introducing application state
// beyond the values the editor and shell already own.
function renderUiState() {
  const text = mainEditor.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  currentPathElement.textContent = currentPath;
  editorStatusElement.textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} character${text.length === 1 ? '' : 's'}`;
  editorTitleElement.textContent = currentRecord?.name || 'no scene loaded';
}

function setSaveStatus(status) {
  saveStatusElement.textContent = status;
  saveStatusElement.dataset.state = status;
}

function setTerminalState(status) {
  terminalStateElement.textContent = status;
  terminalStateElement.dataset.state = status;
}

// Sliders update both their visible values and their filled tracks immediately.
// Reset uses the defaults declared beside each input in index.html.
function setupCreativeControls() {
  const panel = document.getElementById('creative-controls');
  panel.addEventListener('input', handleCreativeInput);
}

function updateSlider(slider) {
  const output = document.querySelector(`[data-value-for="${slider.id}"]`);
  if (output) output.textContent = `${slider.value}%`;
  slider.style.setProperty('--value', `${slider.value}%`);
  slider.style.setProperty('--slider-color', `hsl(${195 + Number(slider.value) * 1.25} 100% 62%)`);
}

function getDefaultCreativeControls() {
  return Object.fromEntries(creativeControlIds.map(id => {
    const control = document.getElementById(id);
    return [id, control.dataset.default ?? ''];
  }));
}

function showCreativeControls(values, localIds = new Set()) {
  for (const id of creativeControlIds) {
    const control = document.getElementById(id);
    control.value = values[id] ?? '';
    control.dataset.source = currentRecord && !localIds.has(id) ? 'inherited' : 'local';
    control.title = control.dataset.source === 'inherited' ? 'Inherited from a parent' : '';
    if (control.matches('input[type="range"]')) updateSlider(control);
  }
}

function handleCreativeInput(event) {
  const control = event.target;
  if (!creativeControlIds.includes(control.id)) return;
  if (control.matches('input[type="range"]')) updateSlider(control);
  if (currentRecord) {
    creativeOverrideIds.add(control.id);
    control.dataset.source = 'local';
    control.title = '';
    setSaveStatus('unsaved');
  } else {
    globalCreativeControls[control.id] = control.value;
  }
  setTerminalState('controls changed');
}

function resetCreativeControls() {
  if (currentRecord) {
    creativeOverrideIds.clear();
    showCreativeControls(resolveCreativeControls(currentRecord, true), creativeOverrideIds);
    setSaveStatus('unsaved');
    setTerminalState('inheriting parent controls');
  } else {
    globalCreativeControls = getDefaultCreativeControls();
    showCreativeControls(globalCreativeControls);
    setTerminalState('controls reset');
  }
}

function readCreativeControls() {
  return Object.fromEntries(creativeControlIds.map(id => [id, document.getElementById(id).value]));
}

function readCreativeOverrides() {
  const values = readCreativeControls();
  return Object.fromEntries([...creativeOverrideIds].map(id => [id, values[id]]));
}

// Long and short flag names are accepted by the same command branches.
// tokenizeCommand() expands a combined flag such as -rf into -r and -f.
function hasFlag(flags, ...names) {
  return names.some(name => flags.includes(name));
}

// Story paths are virtual. OPFS does not contain this folder structure; it
// stores flat JSON files by immutable ID while each record carries its path.
// Normalization removes duplicate separators, dots, and parent traversals.
function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    part === '..' ? parts.pop() : parts.push(part);
  }
  return '/' + parts.join('/');
}

function resolvePath(path) {
  if (!path || path === '.') return currentPath;
  return normalizePath(path.startsWith('/') ? path : `${currentPath}/${path}`);
}

function isPathInside(path, scope) {
  return path?.startsWith(scope === '/' ? '/' : scope + '/');
}

function inferType(path) {
  // The hierarchy is fixed: /folder/book/chapter/scene.
  return ['root', 'folder', 'book', 'chapter', 'scene'][normalizePath(path).split('/').filter(Boolean).length] || null;
}

// IDs remain valid after a move, while paths are convenient in the terminal,
// so record lookup accepts either form.
function findRecord(pathOrId) {
  if (!pathOrId) return null;
  return recordArray.find(record => record.id === pathOrId)
    || recordArray.find(record => record.path === resolvePath(pathOrId))
    || null;
}

function formatRecord(record) {
  return `${(record.type || 'record').padEnd(7)} ${record.path || record.id}`;
}

function getScenesUnder(path) {
  return recordArray
    .filter(record => record.type === 'scene' && (record.path === path || isPathInside(record.path, path)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.path.localeCompare(b.path));
}

// Controls resolve through the same virtual hierarchy as story context.
// Each record stores only its own overrides, so later parent edits still flow
// down to children that have not overridden that specific value.
function resolveCreativeControls(record, ignoreCurrent = false) {
  const resolved = { ...globalCreativeControls };
  const hierarchy = recordArray
    .filter(item => item.path && (item.path === record.path || isPathInside(record.path, item.path)))
    .sort((a, b) => a.path.length - b.path.length);
  for (const item of hierarchy) {
    if (!ignoreCurrent || item.id !== record.id) Object.assign(resolved, item.creativeControls || {});
  }
  return resolved;
}

// Build the user message from the scene and all of its ancestors. The order
// is broad context first and scene-specific context last.
function resolveSceneContext(scene, controls = resolveCreativeControls(scene)) {
  const hierarchy = recordArray
    .filter(record => record.path && (record.path === scene.path || isPathInside(scene.path, record.path)))
    .sort((a, b) => a.path.length - b.path.length)
    .map(record => [
      `${record.type}: ${record.path}`,
      record.premise,
      record.instructions,
      record.type === 'scene' ? record.content : null
    ].filter(Boolean).join('\n'))
    .join('\n\n');
  return [hierarchy, getCreativeContext(controls)].filter(Boolean).join('\n\n');
}

// Creative controls are prompt guidance rather than a second settings engine.
// This keeps them provider-independent while still making every control useful.
function getCreativeContext(values) {
  const notes = [
    ['Core hook', values['premise-corehook']],
    ['Style guide', values['style-guide']],
    ['World rules and constraints', values['world-rules-constraints']],
    ['Character ledger and arcs', values['character-ledger-and-arcs']]
  ].filter(([, value]) => value.trim());
  return [
    'Creative controls:',
    `Length: ${values.length}/100`,
    `Pacing: ${values.pacing}/100`,
    `Chaos: ${values.chaos}/100`,
    `Dialogue share: ${values['dialogue-share']}/100`,
    `Tension: ${values.tension}/100`,
    ...notes.map(([label, value]) => `${label}: ${value}`)
  ].join('\n');
}

// Map only controls with a sensible API equivalent. Dialogue share and the
// prose notes remain prompt guidance because chat APIs have no direct fields
// for them.
function getGenerationParams(values) {
  const scale = (value, minimum, maximum) => minimum + Number(value) / 100 * (maximum - minimum);
  return {
    max_tokens: Math.round(scale(values.length, 256, 4096)),
    temperature: Number(scale(values.chaos, 0.2, 1.5).toFixed(2)),
    top_p: Number(scale(values.pacing, 0.65, 1).toFixed(2)),
    presence_penalty: Number(scale(values.tension, 0, 0.8).toFixed(2))
  };
}

async function refreshRecords() {
  recordArray = await loadAllRecords(recordDirectory);
  document.getElementById('explorer-content').textContent = recordArray
    .sort((a, b) => (a.path || a.id).localeCompare(b.path || b.id))
    .map(formatRecord)
    .join('\n') || 'no records yet';
}

// New records use one consistent shape. The path depth supplies the node type,
// and a scene created with touch becomes the active editor record immediately.
async function createRecord(path, requestedType) {
  if (findRecord(path)) return printTerminal(`Path already exists: ${path}`);
  const type = requestedType || inferType(path);
  if (!type || type === 'root' || (requestedType === 'scene' && inferType(path) !== 'scene')) {
    return printTerminal('Paths must follow /folder/book/chapter/scene.');
  }
  const parentPath = normalizePath(path.substring(0, path.lastIndexOf('/')) || '/');
  if (parentPath !== '/' && !findRecord(parentPath)) return printTerminal(`Parent path not found: ${parentPath}`);
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    type,
    path,
    parentPath,
    name: path.split('/').pop(),
    order: recordArray.filter(item => item.parentPath === parentPath).length,
    premise: '',
    content: '',
    creativeControls: {},
    createdAt: now,
    updatedAt: now
  };
  await saveRecord(recordDirectory, record);
  await refreshRecords();
  if (type === 'scene') {
    currentRecord = record;
    currentPath = path;
    mainEditor.value = '';
    creativeOverrideIds.clear();
    showCreativeControls(resolveCreativeControls(record), creativeOverrideIds);
    setSaveStatus('saved');
  }
  printTerminal(`Created ${type}: ${path}`);
}

// Send one OpenAI-compatible chat-completions request for one scene. The
// system prompt and inherited story context are separate message roles.
async function openaiGen(context, params) {
  try {
    const response = await fetch(`${endpointInput.value.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        model: modelInput.value,
        ...params,
        messages: [
          { role: 'system', content: systemPromptInput.value },
          { role: 'user', content: context }
        ]
      })
    });
    const output = await response.json();
    if (!response.ok || output?.error) throw new Error(output?.error?.message || `HTTP ${response.status}`);
    const content = output?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('API response missing content.');
    return content;
  } catch (error) {
    console.error('Generation failed:', error);
    return null;
  }
}

function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(apiKeyInput.value && { Authorization: `Bearer ${apiKeyInput.value}` })
  };
}

// Store the small provider configuration in localStorage. Story records stay
// in OPFS and are never mixed into this configuration object.
function loadConfig() {
  try {
    const config = JSON.parse(localStorage.getItem('config')) || {};
    endpointInput.value = config.endpoint || '';
    apiKeyInput.value = config.apiKey || '';
    modelInput.value = config.model || '';
    systemPromptInput.value = config.systemPrompt || '';
    Object.assign(globalCreativeControls, config.creativeControls || {});
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

function saveConfig() {
  localStorage.setItem('config', JSON.stringify({
    endpoint: endpointInput.value,
    apiKey: apiKeyInput.value,
    model: modelInput.value,
    systemPrompt: systemPromptInput.value,
    creativeControls: globalCreativeControls
  }));
  setTerminalState('configuration saved');
}

init();


// Fetch the model list from an OpenAI-compatible /models endpoint and replace
// the selector options with the IDs returned by the provider.
async function getModels() {
  if (!endpointInput.value) return;
  try {
    const response = await fetch(`${endpointInput.value.replace(/\/$/, '')}/models`, { headers: apiHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || `HTTP ${response.status}`);
    if (!Array.isArray(result?.data)) throw new Error('Model response is missing data.');
    availableModelsSelect.replaceChildren(
      new Option('available models', ''),
      ...result.data.filter(model => model.id).map(model => new Option(model.id, model.id))
    );
    setTerminalState(`${result.data.length} model${result.data.length === 1 ? '' : 's'}`);
  } catch (error) {
    console.error('Failed to fetch models:', error);
  }
}

function syncModelSelect() {
  modelInput.value = availableModelsSelect.value;
}

let opfsRoot;

// OPFS provides private, browser-managed storage for this origin. Cherenkov
// keeps every story record in the single "records" directory below the root.
async function readJson(fileHandle) {
  return JSON.parse(await (await fileHandle.getFile()).text());
}

async function writeJson(fileHandle, data) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// Record files are named <immutable-id>.json. Virtual moves only update the
// path fields inside these files; their OPFS filenames never need to change.
function getRecordDirectory() {
  return opfsRoot.getDirectoryHandle('records', { create: true });
}

function getRecordHandle(recordsDirectory, id, create = false) {
  return recordsDirectory.getFileHandle(`${id}.json`, { create });
}

async function saveRecord(recordsDirectory, record) {
  if (!record) throw new TypeError('A record is required.');
  record.id ||= crypto.randomUUID();
  await writeJson(await getRecordHandle(recordsDirectory, record.id, true), record);
}

async function moveRecord(sourcePath, newPath, force) {
  let record = findRecord(sourcePath);
  if (!record) {
    printTerminal(`Record not found: ${sourcePath}`);
    return false;
  }
  if (newPath === sourcePath || isPathInside(newPath, sourcePath)) {
    printTerminal('A record cannot be moved into itself.');
    return false;
  }
  const destination = findRecord(newPath);
  if ((destination && !force) || inferType(newPath) !== record.type) {
    printTerminal(`Invalid destination: ${newPath}`);
    return false;
  }
  const parentPath = normalizePath(newPath.substring(0, newPath.lastIndexOf('/')) || '/');
  if (parentPath !== '/' && !findRecord(parentPath)) {
    printTerminal(`Parent path not found: ${parentPath}`);
    return false;
  }
  if (destination) {
    const replaced = destination.type === 'scene'
      ? [destination]
      : recordArray.filter(item => item.path === newPath || isPathInside(item.path, newPath));
    for (const item of replaced) await deleteRecord(recordDirectory, item.id);
    await refreshRecords();
    record = findRecord(sourcePath);
  }
  // Containers and all descendants receive the same path-prefix replacement.
  for (const item of recordArray.filter(item => item.path === sourcePath || isPathInside(item.path, sourcePath))) {
    item.path = newPath + item.path.slice(sourcePath.length);
    item.parentPath = normalizePath(item.path.substring(0, item.path.lastIndexOf('/')) || '/');
    item.name = item.path.split('/').pop();
    item.updatedAt = new Date().toISOString();
    await saveRecord(recordDirectory, item);
  }
  if (currentPath === sourcePath || isPathInside(currentPath, sourcePath)) {
    currentPath = newPath + currentPath.slice(sourcePath.length);
  }
  await refreshRecords();
  currentRecord = currentRecord ? recordArray.find(item => item.id === currentRecord.id) : null;
  if (currentRecord) setSaveStatus('saved');
  return true;
}

async function loadAllRecords(recordsDirectory) {
  const records = [];
  for await (const handle of recordsDirectory.values()) {
    if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;
    try {
      records.push(await readJson(handle));
    } catch (error) {
      console.error(`Failed to read record from ${handle.name}:`, error);
    }
  }
  return records;
}

async function deleteRecord(recordsDirectory, id) {
  try {
    await (await getRecordHandle(recordsDirectory, id)).remove();
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
}

