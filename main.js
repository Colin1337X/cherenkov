//first shits first
async function init() {
    

    saveConfigButton.addEventListener('click', saveconfig);
    getModelsButton.addEventListener('click', getModels);
    loadconfig();
    await getModels();
    await initStorage().then(root => opfsroot = root);
    availableModelsSelect.addEventListener('change', syncmodelselect);
    recordDirectory = await getRecordDirectory();
    recordArray = await loadAllRecords(recordDirectory);
    commandInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = commandInput.value.trim();
        await tokenizecommand(command);
      }
    });
    

}
const explorer = document.getElementById("explorer");
const commandInput = document.getElementById("terminal-input");
let recordDirectory;
let recordArray = [];


async function tokenizecommand(command) {
  command = commandInput.value.trim();
  if (command === '') {
    return null;
  }
  command.flags = command.match(/--\S*/g) || [];
  command.cmd = (command.match(/^\S*/));
  command.directories = command.match(/[^\s"']+\/[^\s"']+/g) || [];
  command.inputdir = command.directories.slice(-1)[0] || null;
  command.outputdir = command.directories.slice(-2)[0] || null;
  return await executecommand(command.cmd, command.flags, command.inputdir, command.outputdir);
}

async function executecommand(cmd, flags, inputdir, outputdir) {
  let pwd
  if (cmd === 'generate' || cmd === 'gen' || cmd === 'g') {
    if (flags.includes('--missing')) {
      document.getElementById("terminal-output").value += 'Generating text with missing context...\n'
      console.log('Generating text with missing context...');
      for (const record of recordArray == null ? [] : recordArray) {  
        await openaigen(
          document.getElementById("openai-endpoint").value,
          document.getElementById("openai-api-key").value,
          document.getElementById("openai-model").value,
          {}, // genparams placeholder
          pwd.value,
          document.getElementById("system-prompt").value
        );
      }
  }
  if (cmd === 'save' || cmd === 's') {
    await saveRecord(recordDirectory, { id: crypto.randomUUID(), content: mainEditor.value });
  }
  if (cmd === 'load' || cmd === 'l') {
    document.getElementById("terminal-output").value += 'Loading record: ' + inputdir + '\n'
    console.log('Loading record:', inputdir);
    const mainEditor = document.getElementById("main-editor");
    mainEditor.value = await loadRecord(recordDirectory, inputdir || pwd);
    console.log('Loaded record:', mainEditor.value);
    pwd = inputdir;
  }
  if (cmd === 'delete' || cmd === 'del' || cmd === 'd') {
    await deleteRecord(recordDirectory, inputdir);
  }
  if (cmd === 'list' || cmd === 'ls') {
    recordArray = await loadAllRecords(recordDirectory);
    document.getElementById("terminal-output").value += 'Available records:\n' + recordArray.join('path\n') + '\n' 
    console.log('Available records:', recordArray); 
    document.getElementById("explorer-content").textContent = recordArray.join('path\n') + '\n';
  }
  if (cmd === 'clear' || cmd === 'clr' || cmd === 'cls') {
    document.getElementById("terminal-output").value = '';
  }
  if (cmd === 'help' || cmd === 'h') {
    document.getElementById("terminal-output").value += 'Available commands:\n' + 
    'generate | gen | g: Generate text using API\n' +
    'save | s: Save current editor content as a record\n' +
    'load | l <record_id>: Load a record by ID\n' +
    'delete | del | d <record_id>: Delete a record by ID\n' +
    'list | ls: List all available records\n' +
    'clear | clr | cls: Clear the terminal output\n' +
    'help | h: Show this help message\n' +
    'move | mv <record_id> <new_directory>: Move a record to a new directory\n';
  }
  if (cmd === 'move' || cmd === 'mv') {
    await moveRecord(recordDirectory, inputdir, outputdir);
  }
  if (cmd === 'new' || cmd === 'touch') {
    await saveRecord(recordDirectory, { id: crypto.randomUUID(), content: '' });
  }
}
}

//openai shit
async function openaigen(endpoint, apikey, model, genparams, currentcontext, systemprompt) {
  let response;
  let output;
  try { 
        response = await fetch(endpoint + (endpoint.endsWith('/') ? '' : '/') + "chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apikey}`
            },
            body: JSON.stringify({
              "model": model,
              "messages": [
                {"role": "system", "content": await promptcompose(currentcontext, systemprompt)},
                {genparams},
                
              ]
            })
        }); 
          output = await response.json();
          if (output && output.error) {
            console.error('API error:', output.error);
            return null;
          }
          if (response.status==401 || response.status==403) {
            console.error('Unauthorized: Invalid API key or endpoint.');
            return null;
          }
          if (response.status==429) {
            console.error('Rate limit exceeded: Too many requests.');
            return null;
          }
          if (response.status==500) {
            console.error('Internal server error: The server encountered an unexpected condition.');
            return null;
          }
          if (response.status==503) {
            console.error('Service unavailable: The server is currently unable to handle the request.');
            return null;
          }
          if (response.status==404) {
            console.error('Not found: The requested resource could not be found. Check the endpoint URL.');
            return null;
          }
          if (response.status==400) {
            console.error('Bad request: The request was invalid or cannot be served. Check the request payload.');
            return null;
          }
          if (response.ok === false) {
            console.error('API response:', output, "Status:", response.status );
            console.error(`Misc. HTTP error! Status: ${response.status}`);
            return null;
          }
          if (!output || output.choices?.[0]?.message?.content === null || output.choices?.[0]?.message?.content === undefined || output.choices?.[0]?.message?.content === '' || !output.choices?.[0]?.message?.content) {
            console.error('API response missing content:', output);
            return null;
          }
          
          else {
            console.debug('API response:', output, "Status:", response.status );
            console.log(output.choices?.[0]?.message?.content);
            document.getElementById("main-editor").value += output.choices?.[0]?.message?.content;
          }
    }
      catch (error) {
      if (error instanceof SyntaxError) {
        console.error('Failed to parse JSON response:', error);
        return null;
      }
      

      else {
        console.error('Unexpected error:', error);
        return null;
      }
    }
}
    



//config shit
function loadconfig() {
  try {
        const config = JSON.parse(localStorage.getItem("config"));
        if (config === null) {
            return;
        }
        document.getElementById("openai-endpoint").value = config.endpoint = (config.endpoint !== undefined && config.endpoint !== null && config.endpoint !== '') ? config.endpoint : "https://nothing.here:8080/v1";
        document.getElementById("openai-api-key").value = config.apiKey = (config.apiKey !== undefined && config.apiKey !== null && config.apiKey !== '') ? config.apiKey : "";
        document.getElementById("openai-model").value = config.model = (config.model !== undefined && config.model !== null && config.model !== '') ? config.model : "example model";
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
function promptcompose(ctx, sysprmpt) {
    return "System Prompt:" + (sysprmpt) + "\nContext:" + (ctx);
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

  if (!endpointInput?.value || !selectElement) {
    console.error('Required DOM elements or inputs are missing.');
    return;
  }

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

    if (!availableModels?.data) {
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
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  } catch (error) {
    console.error('Failed to write JSON to file:', error);
    return null;
  }
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
  if (!record || !record.id) {
    console.warn('Invalid record: Record must have an "id" property.');   
    if (!record) {
      console.error('Record is null or undefined:', record, "Please provide a valid record object.");
      return null;
    }
    if (!record.id) {
        console.warn('Record is missing "id" property:', record);
        record.id = crypto.randomUUID();
        if(await writeJson(await getRecordHandle(recordsDirectory, record.id, true), record) == undefined){
          console.log('Record saved with generated id:', record.id);
        }
        else {
          console.error('Failed to save record with generated id:', record);
        }
        return null;
      }
    }
  const fileHandle = await getRecordHandle(
    recordsDirectory,
    record.id,
    true
  );
  let writeResult = await writeJson(fileHandle, record);
  if (writeResult === null) {
    console.error('Failed to save record:', record);
    console.error('Please check the file system permissions and available storage space.');
    console.debug('Record data:', record);
    console.debug('File handle:', fileHandle);
    console.debug('Records directory:', recordsDirectory);
    console.debug('OPFS root:', opfsroot);
    console.debug('Current working directory:', opfsroot);
    console.debug('Available storage estimate:', await navigator.storage.estimate());
    console.debug('Available storage quota:', (await navigator.storage.estimate()).quota);
    console.debug('Available storage usage:', (await navigator.storage.estimate()).usage);
    console.debug('Available storage usage details:', (await navigator.storage.estimate()).usageDetails);
    console.warn('Attempting to write record again after failure...');
    await writeJson(fileHandle, record);
  }
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

async function moveRecord(recordsDirectory, id, type, path, newDirectory, newId, newPath) {
  const fileHandle = await getRecordHandle(recordsDirectory, id);
  const newFileHandle = await getRecordHandle(newDirectory, newId, true);
  const record = await readJson(fileHandle);
  await writeJson(newFileHandle, record);
  await deleteFile(fileHandle);
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
      console.error(`Record with id ${id} does not exist.`);
      return;
    }
    if (error.name === 'InvalidStateError') {
      console.error(`Cannot delete record with id ${id}:`, error);
      return;
    }
    if (error.name === 'SecurityError') {
      console.error(`Permission denied to delete record with id ${id}:`, error);
      return;
    }
    if (error.name === 'TypeError') {
      console.error(`Invalid file handle for record with id ${id}:`, error);
      return;
    }
    if (error.name === 'DOMException') {
      console.error(`DOMException occurred while deleting record with id ${id}:`, error);
      return;
    }
    if (error.name === 'AbortError') {
      console.error(`Operation aborted while deleting record with id ${id}:`, error);
      return;
    }
    if (error.name === 'QuotaExceededError') {
      console.error(`Quota exceeded while deleting record with id ${id}:`, error);
      return;
    }
    else {
      console.error(`Unexpected error while deleting record with id ${id}:`, error);
      return;
    }
  }
}

