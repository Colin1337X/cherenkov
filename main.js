// Start the application after the deferred script has access to the page.
// Configuration is loaded first, then OPFS records are loaded, and finally
// the terminal listener is attached so commands always have storage ready.
async function init() {
    saveConfigButton.addEventListener('click', saveconfig);
    getModelsButton.addEventListener('click', getModels);
    availableModelsSelect.addEventListener('change', syncmodelselect);
    loadconfig();
    await getModels();
    await initStorage().then(root => opfsroot = root);
    recordDirectory = await getRecordDirectory();
    await refreshRecords();
    commandInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = commandInput.value.trim();
        commandInput.value = '';
        await tokenizecommand(command);
      }
    });
}

const commandInput = document.getElementById("terminal-input");
const mainEditor = document.getElementById("main-editor");
const terminalOutput = document.getElementById("terminal-output");

// These values are shared by every terminal command. In particular,
// currentPath must live outside executecommand() so it survives between
// commands in the same way a shell's working directory does.
let recordDirectory;
let recordArray = [];
let currentPath = '/';
let currentRecord = null;


// Turn raw terminal text into one small command object. Flags are kept
// separate from positional arguments, and quoted values remain one argument.
async function tokenizecommand(command) {
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
  return executecommand({
    cmd: parts[0].toLowerCase(),
    flags,
    args
  });
}

// Dispatch one parsed command. Each branch returns after it finishes so the
// handlers stay independent instead of accidentally nesting inside each other.
async function executecommand({ cmd, flags, args }) {
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
      const content = await openaigen(resolveSceneContext(record));
      if (content === null) {
        printTerminal(`Generation failed: ${record.path}`);
        return;
      }
      record.content = content;
      record.updatedAt = new Date().toISOString();
      await saveRecord(recordDirectory, record);
      if (currentRecord?.id === record.id) mainEditor.value = content;
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
    currentRecord.updatedAt = new Date().toISOString();
    await saveRecord(recordDirectory, currentRecord);
    await refreshRecords();
    printTerminal(`Saved ${currentRecord.path}.`);
    return;
  }

  if (cmd === 'load' || cmd === 'l') {
    const record = findRecord(inputdir || currentPath);
    if (!record) {
      printTerminal(`Record not found: ${inputdir || currentPath}`);
      return;
    }
    currentRecord = record;
    currentPath = record.path;
    mainEditor.value = record.content || '';
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
}

// Long and short flag names are accepted by the same command branches.
// tokenizecommand() expands a combined flag such as -rf into -r and -f.
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

// Build the user message from the scene and all of its ancestors. The order
// is broad context first and scene-specific context last.
function resolveSceneContext(scene) {
  return recordArray
    .filter(record => record.path && (record.path === scene.path || isPathInside(scene.path, record.path)))
    .sort((a, b) => a.path.length - b.path.length)
    .map(record => [
      `${record.type}: ${record.path}`,
      record.premise,
      record.instructions,
      record.type === 'scene' ? record.content : null
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

async function refreshRecords() {
  recordArray = await loadAllRecords(recordDirectory);
  document.getElementById('explorer-content').textContent = recordArray
    .sort((a, b) => (a.path || a.id).localeCompare(b.path || b.id))
    .map(formatRecord)
    .join('\n');
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
    createdAt: now,
    updatedAt: now
  };
  await saveRecord(recordDirectory, record);
  await refreshRecords();
  if (type === 'scene') {
    currentRecord = record;
    currentPath = path;
    mainEditor.value = '';
  }
  printTerminal(`Created ${type}: ${path}`);
}

// Send one OpenAI-compatible chat-completions request for one scene. The
// system prompt and inherited story context are separate message roles.
async function openaigen(currentcontext) {
  const endpoint = document.getElementById("openai-endpoint").value.replace(/\/$/, '');
  const apikey = document.getElementById("openai-api-key").value;
  const model = document.getElementById("openai-model").value;
  const systemprompt = document.getElementById("system-prompt").value;
  try { 
        const response = await fetch(endpoint + "/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apikey}`
            },
            body: JSON.stringify({
              "model": model,
              "messages": [
                {"role": "system", "content": systemprompt},
                {"role": "user", "content": currentcontext}
              ]
            })
        }); 
        const output = await response.json();
        if (!response.ok || output?.error) throw new Error(output?.error?.message || `HTTP ${response.status}`);
        const content = output?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error('API response missing content.');
        return content;
    }
    catch (error) {
      console.error('Generation failed:', error);
      return null;
    }
}
    



// Store the small provider configuration in localStorage. Story records stay
// in OPFS and are never mixed into this configuration object.
function loadconfig() {
  try {
        const config = JSON.parse(localStorage.getItem("config"));
        if (config === null) {
            return;
        }
        document.getElementById("openai-endpoint").value = config.endpoint || "https://nothing.here:8080/v1";
        document.getElementById("openai-api-key").value = config.apiKey || "";
        document.getElementById("openai-model").value = config.model || "example model";
  } catch (error) {
      console.error('Failed to load config:', error);
  }
}
function saveconfig() {
    const config = {
        endpoint: document.getElementById("openai-endpoint").value,
        apiKey: document.getElementById("openai-api-key").value,
        model: document.getElementById("openai-model").value
    };
    localStorage.setItem("config", JSON.stringify(config));
}
// These controls are present in index.html and are reused during startup.
const saveConfigButton = document.getElementById("save-config-button");
const getModelsButton = document.getElementById("get-models-button");
const availableModelsSelect = document.getElementById("available-models");

init();


// Fetch the model list from an OpenAI-compatible /models endpoint and replace
// the selector options with the IDs returned by the provider.
async function getModels() {
  // Read and validate the three controls needed for this request.
  const endpointInput = document.getElementById('openai-endpoint');
  const apiKeyInput = document.getElementById('openai-api-key');
  const selectElement = document.getElementById('available-models');

  if (!endpointInput || !apiKeyInput || !selectElement) {
    console.error('Required DOM elements are missing.');
    return;
  }

  if(apiKeyInput.value==null || apiKeyInput.value==undefined || apiKeyInput.value==""){
    console.debug('API key is missing.');
    apiKeyInput.value = "";
  }

  if (!endpointInput.value) return;

  const url = `${endpointInput.value.replace(/\/$/, '')}/models`;
  selectElement.innerHTML = '';

  try {
    // Fetching can fail for local providers, invalid keys, or unavailable URLs.
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeyInput.value}`
      }
    });

    const availableModels = await response.json();

    if (!response.ok) {
      console.error('Failed to fetch models');
      return;
    }

    if (!Array.isArray(availableModels?.data)) {
      throw new Error('Invalid API response format: "data" property missing.');
    }


    // Build the options off-screen, then add them to the selector in one step.
    const fragment = document.createDocumentFragment();

    for (const model of availableModels.data) {
      if (model.id) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        fragment.appendChild(option);
      }
    }

    selectElement.appendChild(fragment);

  } catch (error) {
    console.error('Failed to fetch or populate models:', error);
    }
}

function syncmodelselect() {
  const modelSelect = document.getElementById('available-models');
  const modelInput = document.getElementById('openai-model');
  if (modelSelect !== null && modelInput) {
    modelInput.value = modelSelect.value;
  }
}

let opfsroot;

// OPFS provides private, browser-managed storage for this origin. Cherenkov
// keeps every story record in the single "records" directory below the root.
async function initStorage() {
  const root = await navigator.storage.getDirectory();
  return root;
}
async function readJson(fileHandle) {
  const file = await fileHandle.getFile();
  const contents = await file.text();
  return JSON.parse(contents);
}
async function writeJson(fileHandle, data) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}
async function deleteFile(fileHandle) {
  await fileHandle.remove();
}

// Record files are named <immutable-id>.json. Virtual moves only update the
// path fields inside these files; their OPFS filenames never need to change.

async function getRecordDirectory() {
  return await opfsroot.getDirectoryHandle("records", { create: true });
}
async function getRecordHandle(recordsDirectory, id, writeifnotfound) {
  if (writeifnotfound === true) {
    return await recordsDirectory.getFileHandle(id + ".json", { create: true });
  } else {
    return await recordsDirectory.getFileHandle(id + ".json");
  }
}

async function saveRecord(recordsDirectory, record) {
  if (!record) throw new TypeError('A record is required.');
  record.id ||= crypto.randomUUID();
  await writeJson(await getRecordHandle(recordsDirectory, record.id, true), record);
}



async function loadRecord(recordsDirectory, id) {
  try {  
    const fileHandle = await getRecordHandle(recordsDirectory, id);
    return await readJson(fileHandle);
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
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
  return true;
}

async function loadAllRecords(recordsDirectory) {
  const records = [];
  for await (const handle of recordsDirectory.values()) {
    if (handle.kind !== 'file') {
      continue;
    }
    if (!handle.name.endsWith('.json')) {
      continue;
    }
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
    const fileHandle = await getRecordHandle(recordsDirectory, id);
    await deleteFile(fileHandle);
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return;
    }
    throw error;
  }
}

