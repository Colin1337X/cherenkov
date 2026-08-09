//first shits first
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
let recordDirectory;
let recordArray = [];
let currentPath = '/';
let currentRecord = null;


async function tokenizecommand(command) {
  if (command === '') {
    return null;
  }
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(part => part.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')) || [];
  return executecommand({
    cmd: parts.shift().toLowerCase(),
    flags: parts.filter(part => part.startsWith('--')),
    args: parts.filter(part => !part.startsWith('--'))
  });
}

async function executecommand({ cmd, flags, args }) {
  const [inputdir, outputdir] = args;

  if (cmd === 'generate' || cmd === 'gen' || cmd === 'g') {
    const destination = resolvePath(inputdir || currentPath);
    let scenes = getScenesUnder(destination);
    if (flags.includes('--missing')) {
      scenes = scenes.filter(record => !record.content?.trim());
    }
    if (!scenes.length) {
      printTerminal('No scenes to generate.');
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
      printTerminal(`Record not found: ${inputdir || currentPath}`);
      return;
    }
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
    const records = recordArray.filter(record => scope === '/' || record.path === scope || isPathInside(record.path, scope));
    printTerminal(records.length ? records.map(formatRecord).join('\n') : 'No records.');
    return;
  }

  if (cmd === 'clear' || cmd === 'clr' || cmd === 'cls') {
    terminalOutput.value = '';
    return;
  }

  if (cmd === 'help' || cmd === 'h') {
    printTerminal('Commands: pwd, cd <path>, ls [path], touch <scene>, mkdir <path>, load <path|id>, save, mv <source> <destination>, rm <path|id>, generate [--missing] [path], clear, help');
    return;
  }

  if (cmd === 'move' || cmd === 'mv') {
    if (!inputdir || !outputdir) {
      printTerminal('Usage: mv <source> <destination>');
      return;
    }
    const moved = await moveRecord(resolvePath(inputdir), resolvePath(outputdir));
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
    await createRecord(resolvePath(inputdir));
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
  return ['root', 'folder', 'book', 'chapter', 'scene'][normalizePath(path).split('/').filter(Boolean).length] || null;
}

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

//openai shit
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
    



//config shit
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
//dom shit
const saveConfigButton = document.getElementById("save-config-button");
const getModelsButton = document.getElementById("get-models-button");
const availableModelsSelect = document.getElementById("available-models");

init();


// fetching shit
async function getModels() {
  // 1. Get DOM elements and validate inputs
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
    // 3. Fetch data from the API
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


    // 4. Batch DOM updates using a DocumentFragment for better performance
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

//opfs shit
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

//record shit

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

async function moveRecord(sourcePath, newPath) {
  const record = findRecord(sourcePath);
  if (!record) {
    printTerminal(`Record not found: ${sourcePath}`);
    return false;
  }
  if (newPath === sourcePath || isPathInside(newPath, sourcePath)) {
    printTerminal('A record cannot be moved into itself.');
    return false;
  }
  if (findRecord(newPath) || inferType(newPath) !== record.type) {
    printTerminal(`Invalid destination: ${newPath}`);
    return false;
  }
  const parentPath = normalizePath(newPath.substring(0, newPath.lastIndexOf('/')) || '/');
  if (parentPath !== '/' && !findRecord(parentPath)) {
    printTerminal(`Parent path not found: ${parentPath}`);
    return false;
  }
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

