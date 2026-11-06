/* Terminal adapters for the same workspace services used by the graphical controls. */
'use strict';

const workspaceTerminalCommands = {
  mode: ({ args: [mode] }) => {
    if (mode) setWorkspaceMode(mode);
    printTerminal(`Workspace mode: ${isCherenkovMode() ? 'Pure Cherenkov' : 'Xenon'}`);
  },
  focus: ({ args: [value = 'toggle'] }) => {
    if (!['on', 'off', 'toggle'].includes(value)) throw new Error('Use focus on, focus off, or focus.');
    const enabled = value === 'toggle' ? !document.body.classList.contains('focus-mode') : value === 'on';
    setFocusMode(enabled);
    printTerminal(`Focus mode: ${enabled ? 'on' : 'off'}`);
  },
  status: () => printTerminal(`${currentRecord?.path || 'Scratchpad'} · ${editorStatusElement.textContent} · ${saveStatusElement.textContent}`),
  cat: async ({ args: [path] }) => {
    await flushEditor();
    if (!path) return printTerminal(mainEditor.value || '(empty)');
    const record = resolvePath(path) === '/' ? null : terminalRecord(path);
    const text = record?.type === 'scene' ? record.content : getScenesUnder(record?.path || '/').map(scene => `--- ${scene.path} ---\n${scene.content}`).join('\n\n');
    printTerminal(text || '(empty)');
  },
  reasoning: () => printTerminal(byId('reasoning-output').textContent || 'No provider reasoning.'),
  scratch: () => openScratchpad(),
  write: ({ args }) => writeFromTerminal(terminalText(args, 'write <text>')),
  append: ({ args }) => writeFromTerminal(mainEditor.value + (mainEditor.value ? '\n' : '') + terminalText(args, 'append <text>')),
  edit: async () => {
    if (mainEditor.readOnly) throw new Error('Load a scene or use the scratchpad first.');
    const original = mainEditor.value, recordId = currentRecord?.id, epoch = editorEpoch;
    const text = await terminalPrompt('Edit manuscript', { value: original });
    if (text === null) return;
    if (currentRecord?.id !== recordId || mainEditor.value !== original || editorEpoch !== epoch) throw new Error('The editor changed. Reopen edit to work on the latest text.');
    return writeFromTerminal(text);
  },
  select: ({ args: [start, end] }) => {
    const length = mainEditor.value.length;
    if (start === 'all') return setTerminalSelection(0, length);
    if (start === 'clear') return setTerminalSelection(mainEditor.selectionEnd, mainEditor.selectionEnd);
    if (start === undefined && end === undefined) return setTerminalSelection(mainEditor.selectionStart, mainEditor.selectionEnd);
    const from = terminalInteger(start, 0, length, 'start');
    return setTerminalSelection(from, terminalInteger(end, from, length, 'end'));
  },
  find: async ({ args, flags }) => {
    const needle = terminalText(args, 'find <text> [--project]');
    if (!needle) throw new Error('Search text cannot be empty.');
    await flushEditor();
    if (flags.includes('--project')) return printTerminal(searchProject(needle).map(record => record.path).join('\n') || 'No matches.');
    const index = findEditorText(needle);
    if (index < 0) return printTerminal('No matches.');
    setTerminalSelection(index, index + needle.length);
  },
  replace: ({ args: [needle, replacement], flags }) => {
    if (!needle || replacement === undefined) throw new Error('Use replace <find> <replacement> [--all].');
    if (flags.includes('--all')) return writeFromTerminal(mainEditor.value.split(needle).join(replacement));
    const start = mainEditor.selectionStart, end = mainEditor.selectionEnd;
    const index = mainEditor.value.slice(start, end) === needle ? start : findEditorText(needle);
    if (index < 0) return printTerminal('No matches.');
    return writeFromTerminal(mainEditor.value.slice(0, index) + replacement + mainEditor.value.slice(index + needle.length));
  },
  undo: async () => printTerminal(await undoEdit() ? 'Undone.' : 'Nothing to undo.'),
  redo: async () => printTerminal(await undoEdit(true) ? 'Redone.' : 'Nothing to redo.'),
  next: async () => { if (!await navigateScene(1)) printTerminal('No next scene.'); },
  previous: async () => { if (!await navigateScene(-1)) printTerminal('No previous scene.'); },
  controls: ({ args }) => terminalControls(args),
  css: async ({ args: [action = 'show', ...args] }) => {
    if (action === 'show') return printTerminal(customCss || 'No custom CSS saved.');
    if (action === 'reset') return printTerminal(saveCustomCss(''));
    if (action === 'set') return printTerminal(saveCustomCss(terminalText(args, 'css set <stylesheet>')));
    if (action === 'edit') {
      const css = await terminalPrompt('Edit custom CSS', { value: customCss, maxLength: byId('custom-css').maxLength });
      if (css !== null) printTerminal(saveCustomCss(css));
      return;
    }
    throw new Error('Use css show, css edit, css set <stylesheet>, or css reset.');
  },
  config: ({ args }) => terminalConfig(args),
  profile: ({ args }) => terminalProfiles(args),
  revision: ({ args }) => terminalRevision(args),
  preview: ({ args }) => terminalPreview(args),
  export: ({ args }) => terminalExport(args[0]),
  import: async ({ flags }) => {
    if (flags.includes('--paste')) {
      const text = await terminalPrompt('Paste a workspace JSON export');
      if (text !== null) await importWorkspaceText(text);
    } else {
      printTerminal('Choose a workspace JSON file in the browser file picker.');
      importDataInput.click();
    }
  },
  backup: ({ args }) => terminalBackup(args),
  trash: ({ args: [action = 'list'] }) => {
    if (action === 'restore') return restoreTrash();
    if (action === 'list') return printTerminal((xenonData.trash || []).map(record => `${record.path} · ${record.deletedAt || 'deleted'}`).join('\n') || 'No deleted records.');
    throw new Error('Use trash list or trash restore.');
  },
  cancel: ({ args: [id] }) => cancelGeneration(id)
};

const workspaceTerminalHelp = `Workspace commands:
mode [xenon|cherenkov] | focus [on|off] | status | reasoning | css show|edit|set <stylesheet>|reset
cat [path] | edit | write <text> | append <text> | scratch
select [all|clear|start end] | find <text> [--project] | replace <find> <replacement> [--all]
undo | redo | next | previous | revision list|show|compare|restore [number]
controls show|set <key> <value>|reset [key] | tracker get|set <name> [value]
config show|set <key> <value>|save|models|key [clear] | profile list|servers|save <name>|use <id or name>|current
preview list|show|select|source|reasoning|accept|append|reject|regenerate|copy|export [number]
import [--paste] | export [path] | backup create|list|recover <id>|download <id> | trash list|restore
cancel [job-id]. During a foreground generation, Ctrl+C or Escape cancels.
Use double quotes for text with spaces and \\n for a line break. Use edit to enter or paste multiple lines.`;

function redactTerminalCommand({ cmd, args }, raw) {
  if (cmd !== 'config') return raw;
  const action = args[0]?.toLowerCase();
  const key = args[1]?.replace(/[-_]/g, '').toLowerCase();
  if (action === 'key' || (action === 'set' && ['apikey', 'key'].includes(key))) {
    return action === 'key' && args[1] === 'clear' && args.length === 2 ? 'config key clear' : 'config key';
  }
  return raw;
}

function terminalText(args, usage) {
  if (!args.length) throw new Error(`Use ${usage}.`);
  return args.join(' ');
}
function terminalInteger(text, min, max, label) {
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return number;
}
function terminalRecord(path) {
  const record = findRecord(path);
  if (!record) throw new Error(`Record not found: ${path || '(missing path)'}.`);
  return record;
}
async function writeFromTerminal(text) {
  const changed = await updateManuscript(text);
  printTerminal(changed ? `${currentRecord?.path || 'Scratchpad'} updated.` : 'Text already matches.');
}
function setTerminalSelection(start, end) {
  mainEditor.setSelectionRange(start, end);
  printTerminal(`Selection ${start}–${end}${end > start ? '\n' + mainEditor.value.slice(start, end) : ''}`);
}
function terminalPrompt(message, { secret = false, value = '', maxLength } = {}) {
  if (terminalContent.querySelector('.terminal-prompt')) throw new Error('Finish the current terminal prompt first.');
  const form = document.createElement('form');
  form.className = 'terminal-prompt';
  const label = textNode('label', message);
  const field = document.createElement(secret ? 'input' : 'textarea');
  field.className = 'input-field';
  if (maxLength !== undefined) field.maxLength = maxLength;
  if (secret) { field.type = 'password'; field.autocomplete = 'off'; }
  field.value = value;
  label.append(field);
  const actions = document.createElement('div');
  actions.className = 'toolbar';
  const submit = textNode('button', secret ? 'Save key' : 'Apply');
  submit.className = 'quiet-button';
  submit.type = 'submit';
  actions.append(submit, textNode('small', secret ? 'Enter to save · Esc to cancel' : 'Ctrl+Enter to apply · Esc to cancel'));
  form.append(label, actions);
  terminalContent.append(form);
  terminalContent.classList.add('prompt-active');
  field.focus({ preventScroll: true });
  return new Promise(resolve => {
    function finish(text) {
      field.value = '';
      form.remove();
      terminalContent.classList.remove('prompt-active');
      resolve(text);
    }
    form.addEventListener('submit', event => { event.preventDefault(); finish(field.value); });
    form.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); finish(field.value); }
    });
  });
}

function setTerminalField(field, value) {
  if (field.type === 'checkbox') {
    if (!['on', 'off'].includes(value)) throw new Error('Use on or off.');
    if (field.disabled && value === 'on') throw new Error('This option requires Node mode.');
    field.checked = value === 'on';
  } else if (field.type === 'select-one') {
    if (![...field.options].some(option => option.value === value)) throw new Error(`Choose one of: ${[...field.options].map(option => option.value || '""').join(', ')}.`);
    field.value = value;
  } else if (['number', 'range'].includes(field.type)) {
    const numeric = Number(value);
    if (!value.trim() || !Number.isFinite(numeric) || (field.min && numeric < Number(field.min)) || (field.max && numeric > Number(field.max))) throw new Error(`Use a number${field.min ? ` ≥ ${field.min}` : ''}${field.max ? ` and ≤ ${field.max}` : ''}.`);
    if (field.step === '1' && !Number.isInteger(numeric)) throw new Error('Use a whole number.');
    field.value = numeric;
  } else field.value = value;
}

async function terminalControls([action = 'show', key, ...args]) {
  if (action === 'show') {
    printTerminal(Object.entries(readCreativeControls()).map(([id, value]) => `${id} = ${JSON.stringify(value)}${byId(id).dataset.source === 'inherited' ? ' (inherited)' : ''}`).join('\n'));
    return;
  }
  if (key && !creativeControlIds.includes(key)) throw new Error('Unknown control. Use controls show.');
  if (action === 'set' && key) {
    const field = byId(key);
    setTerminalField(field, terminalText(args, 'controls set <key> <value>'));
    handleCreativeInput({ target: field });
  } else if (action === 'reset') {
    if (!key) resetCreativeControls();
    else if (currentRecord) {
      creativeOverrideIds.delete(key);
      showCreativeControls({ ...resolveCreativeControls(currentRecord, true), ...readCreativeOverrides() }, creativeOverrideIds);
      setSaveStatus('unsaved');
    } else {
      globalCreativeControls[key] = getDefaultCreativeControls()[key];
      showCreativeControls(globalCreativeControls);
    }
  } else throw new Error('Use controls show, controls set <key> <value>, or controls reset [key].');
  if (currentRecord) await flushEditor();
  else await saveConfig();
  printTerminal(`Controls updated for ${currentRecord?.path || 'global defaults'}.`);
}

const terminalConfigFields = {
  endpoint: 'openai-endpoint', model: 'openai-model', 'system-prompt': 'system-prompt',
  'reasoning-effort': 'reasoning-effort', 'max-tokens': 'base-max-tokens', temperature: 'base-temperature',
  'top-p': 'base-top-p', 'presence-penalty': 'base-presence-penalty', proxy: 'use-proxy', 'server-profile': 'server-profile',
  'token-field': 'token-field', timeout: 'request-timeout', retries: 'retry-count',
  'cap-temperature': 'cap-temperature', 'cap-top-p': 'cap-top-p', 'cap-presence': 'cap-presence',
  'cap-reasoning': 'cap-reasoning', 'cap-usage': 'cap-usage'
};

async function terminalConfig([action = 'show', key, ...args]) {
  if (action === 'show') {
    const fields = Object.entries(terminalConfigFields).map(([name, id]) => {
      const field = byId(id);
      return `${name} = ${field.type === 'checkbox' ? (field.checked ? 'on' : 'off') : JSON.stringify(field.value)}`;
    });
    printTerminal([...fields, `api-key = ${apiKeyInput.value ? '(set)' : '(unset)'}`].join('\n'));
    return;
  }
  if (action === 'models') return printTerminal((await getModels()).join('\n') || 'No models returned.');
  if (action === 'key') {
    if (args.length || (key !== undefined && key !== 'clear')) throw new Error('Use config key for masked entry or config key clear.');
    const value = key === 'clear' ? '' : await terminalPrompt('Provider API key', { secret: true });
    if (value === null) return;
    apiKeyInput.value = value.trim();
  } else if (action === 'set') {
    if (!Object.hasOwn(terminalConfigFields, key)) throw new Error('Unknown setting. Use config show. Use config key for a provider key.');
    setTerminalField(byId(terminalConfigFields[key]), terminalText(args, 'config set <key> <value>'));
  } else if (action !== 'save') throw new Error('Use config show, set, save, models, or key.');
  await saveConfig();
  printTerminal('Configuration saved.');
}

async function terminalProfiles([action = 'list', ...args]) {
  if (action === 'list') return printTerminal(xenonData.profiles.map(profile => `${profile.id === xenonData.activeProfile ? '*' : ' '} ${profile.id} ${profile.name}`).join('\n') || 'No profiles saved.');
  if (action === 'servers') return printTerminal((workspaceStorage.serverProfiles || []).join('\n') || 'No server profiles configured.');
  if (action === 'save') return printTerminal(`Saved profile ${(await saveEndpointProfile(terminalText(args, 'profile save <name>'))).name}.`);
  if (action === 'current') { await selectEndpointProfile(''); return printTerminal('Using current settings without a named profile.'); }
  if (action === 'use') {
    const name = terminalText(args, 'profile use <id or name>');
    const profiles = xenonData.profiles.filter(profile => profile.id === name || profile.name === name);
    if (profiles.length !== 1) throw new Error(profiles.length ? 'Use the profile ID to disambiguate.' : 'Profile not found.');
    await selectEndpointProfile(profiles[0].id);
    return printTerminal(`Using profile ${profiles[0].name}.`);
  }
  throw new Error('Use profile list, servers, save, use, or current.');
}

async function terminalTrackerValue([action, name, ...args]) {
  await flushEditor();
  const record = terminalRecord(currentPath);
  if (!getApplicableTrackers(record.path).some(tracker => tracker.name === name)) throw new Error('Tracker is not available at this path.');
  if (action === 'get') return printTerminal(Object.hasOwn(record.trackers || {}, name) ? record.trackers[name] || '(empty)' : '(empty)');
  const value = terminalText(args, 'tracker set <name> <value>');
  await saveTrackerInput({ target: { dataset: { tracker: name }, value } });
  printTerminal(`Saved ${name} for ${record.path}.`);
}

async function terminalRevision([action = 'list', index]) {
  await flushEditor();
  if (currentRecord?.type !== 'scene') throw new Error('Load a scene first.');
  const revisions = (currentRecord.revisions || []).slice().reverse();
  if (action === 'list') return printTerminal(revisions.map((revision, i) => `${i + 1} · ${revision.at || 'saved'} · ${revision.reason || 'edit'}`).join('\n') || 'No saved revisions.');
  if (!['show', 'compare', 'restore'].includes(action)) throw new Error('Use revision list, show, compare, or restore.');
  if (!revisions.length) throw new Error('No saved revisions.');
  const revision = revisions[terminalInteger(index, 1, revisions.length, 'Revision number') - 1];
  if (action === 'restore') return writeFromTerminal(revision.content);
  printTerminal(action === 'compare' ? `--- Revision ${index} ---\n${revision.content}\n\n--- Current ---\n${mainEditor.value}` : revision.content);
}

async function terminalExport(path) {
  if (!path || resolvePath(path) === '/') {
    await exportUserData();
    return printTerminal('Downloaded xenon-workspace.json.');
  }
  await flushEditor();
  const scope = terminalRecord(path).path;
  const data = cleanExport(buildUserData());
  data.records = data.records.filter(record => Xenon.inside(record.path, scope) || Xenon.inside(scope, record.path));
  data.bible = data.bible.filter(entry => Xenon.inside(entry.book, scope) || entry.book === Xenon.bookPath(scope) || entry.book === '/');
  download('xenon-workspace.json', data);
  printTerminal(`Downloaded workspace export for ${scope}.`);
}

async function terminalBackup([action = 'create', id]) {
  if (action === 'create') return makeWorkspaceBackup();
  if (action === 'list') return printTerminal((await workspaceStorage.listBackups()).join('\n') || 'No stored backups.');
  if (!['recover', 'download'].includes(action) || !id) throw new Error('Use backup create, list, recover <id>, or download <id>.');
  const backup = await workspaceStorage.readBackup(id);
  if (action === 'recover') return mergeWorkspace(backup);
  download('xenon-backup.json', cleanExport(backup));
  printTerminal('Downloaded backup.');
}

function streamToTerminal() {
  const entries = [];
  return (update, index) => {
    const entry = entries[index] ||= printTerminal(`Candidate ${index + 1} streaming…`);
    entry.textContent = `Candidate ${index + 1}\n${update.content || '(waiting for prose)'}\n`;
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  };
}
function terminalPreviewResult() {
  printTerminal(`${byId('preview-status').textContent}\nUse preview list, preview show, preview accept, or preview export.`);
}
async function terminalPreview([action = 'list', index]) {
  if (isCherenkovMode() && !preview?.run.legacy) throw new Error('Switch to Xenon to review Xenon candidates.');
  if (action === 'regenerate') {
    if (isCherenkovMode()) throw new Error('Use generate to rerun legacy generation.');
    await regenerateCandidate(streamToTerminal());
    return terminalPreviewResult();
  }
  if (!preview?.candidates.length) throw new Error('No candidates to review.');
  if (action === 'list') return printTerminal(preview.candidates.map((candidate, i) => `${i + 1} · ${candidate.content?.length || 0} characters${candidate === selectedCandidate() ? ' (selected)' : ''}`).join('\n'));
  if (action === 'select' || index !== undefined) {
    byId('candidate-select').value = String(terminalInteger(index, 1, preview.candidates.length, 'Candidate number') - 1);
    renderPreview();
    if (preview.run.operation === 'extract' && !activeOperation) renderExtraction();
  }
  const candidate = selectedCandidate();
  if (action === 'select' || action === 'show') return printTerminal(candidate.content || '(empty)');
  if (action === 'source') return printTerminal(preview.run.input || '(empty)');
  if (action === 'reasoning') return printTerminal(candidate.reasoning || 'No provider reasoning.');
  if (action === 'accept' || action === 'append') {
    if (!candidate.content) throw new Error('This candidate is empty.');
    await acceptCandidate(action === 'append' ? 'append' : undefined);
    return printTerminal('Candidate accepted.');
  }
  if (action === 'reject') { rejectCandidate(); return printTerminal('Candidate rejected.'); }
  if (action === 'copy') { await copyCandidate(); return printTerminal('Copied candidate.'); }
  if (action === 'export') { download('xenon-candidate.txt', candidate.content, 'text/plain'); return printTerminal('Downloaded candidate.'); }
  throw new Error('Unknown preview action. Use help for preview commands.');
}

const xenonTerminalHelp = `Xenon commands:
xenon continue|rewrite|expand|describe|brainstorm|critique|draft|extract [path] [instructions] [--selection]
xenon continuity [path] [--ai] | xenon run
xenon set operation|preset|instructions|input|model|count <value> | xenon settings
xenon preview <action> [number] (same as preview)
xenon bible list [--all] | show <id or name> | add <type> <name> | set <id or name> <field> <value>
xenon bible candidates | accept <number>
xenon context show|rebuild|list | pin|exclude|auto <source id> | budget <tokens> | preferences <text>
xenon jobs [list] | start [operation] | show|review|cancel <id> | xenon cancel [job-id]
xenon export [path]. Use help for the shared workspace commands.`;

const writingFields = { operation: 'writing-operation', preset: 'rewrite-preset', instructions: 'writing-instructions', input: 'writing-input', model: 'operation-model', count: 'candidate-count' };

async function xenonCommand({ args: [action = 'help', ...args], flags }) {
  if (action === 'help') return printTerminal(xenonTerminalHelp);
  if (action === 'settings') return printTerminal(Object.entries(writingFields).map(([key, id]) => `${key} = ${JSON.stringify(byId(id).value)}`).join('\n'));
  if (action === 'set') {
    const [key, ...values] = args;
    if (!Object.hasOwn(writingFields, key)) throw new Error('Unknown writing setting. Use xenon settings.');
    const field = byId(writingFields[key]);
    setTerminalField(field, terminalText(values, 'xenon set <key> <value>'));
    if (key === 'operation') loadOperationModel();
    if (key === 'model') await saveOperationModel();
    return printTerminal(`${key} set.`);
  }
  if (action === 'continuity' && !flags.includes('--ai')) {
    await flushEditor();
    checkContinuity(args[0] ? resolvePath(args[0]) : getBook() || '/');
    return printTerminal(byId('continuity-results').textContent);
  }
  if (action === 'run' || Object.hasOwn(Xenon.operations, action)) {
    await flushEditor();
    const record = args[0]?.startsWith('/') ? terminalRecord(args.shift()) : currentRecord;
    if (flags.includes('--selection') && (record?.id !== currentRecord?.id || mainEditor.selectionStart === mainEditor.selectionEnd)) throw new Error('Use select <start> <end> or select all first.');
    const operation = action === 'run' ? undefined : action;
    await runWriting(captureOperation(operation, args.length ? args.join(' ') : undefined, record), streamToTerminal());
    return terminalPreviewResult();
  }
  if (action === 'preview') return terminalPreview(args);
  if (action === 'bible') return terminalBible(args, flags);
  if (action === 'context') return terminalContext(args);
  if (action === 'jobs') return terminalJobs(args);
  if (action === 'export') return terminalExport(args[0]);
  if (action === 'cancel') return cancelGeneration(args[0]);
  throw new Error('Unknown Xenon command. Use xenon help.');
}

async function terminalBible([action = 'list', name, field, ...values], flags) {
  const entries = flags.includes('--all') ? xenonData.bible : xenonData.bible.filter(entry => entry.book === getBook() || entry.book === '/');
  if (action === 'list') return printTerminal(entries.map(entry => `${entry.id} ${entry.type} ${entry.status} ${entry.name} (${entry.book})`).join('\n') || 'No entries in this book.');
  if (action === 'add') {
    const book = getBook();
    if (!book) throw new Error('Load a book or scene first.');
    const entry = Xenon.normalizeBible({ type: name || 'character', name: [field, ...values].filter(Boolean).join(' ') || `New ${name || 'character'}`, book, status: 'draft' });
    await saveBible(entry);
    editBible(entry);
    return printTerminal(`Added ${entry.name} · ${entry.id}`);
  }
  if (action === 'candidates') return printTerminal(extractionCandidates().map((entry, i) => `${i + 1}. ${entry.type} ${entry.name}\n${entry.description}`).join('\n') || 'No extracted entries.');
  if (action === 'accept') {
    const candidates = extractionCandidates();
    if (!candidates.length) throw new Error('No extracted entries.');
    const entry = await acceptExtraction(terminalInteger(name, 1, candidates.length, 'Entry number') - 1);
    return printTerminal(`Saved ${entry.name} as a draft.`);
  }
  if (!['show', 'set'].includes(action)) throw new Error('Unknown Bible action. Use xenon help.');
  const matches = entries.filter(entry => entry.id === name || entry.name === name);
  if (matches.length !== 1) throw new Error(matches.length ? 'Use the entry ID to disambiguate.' : 'Bible entry not found.');
  const entry = matches[0];
  if (action === 'show') return printTerminal(JSON.stringify(entry, null, 2));
  if (!['name', 'type', 'description', 'status', 'aliases', 'references', 'metadata'].includes(field)) throw new Error('Use a Bible field: name, type, description, status, aliases, references, or metadata.');
  let value = terminalText(values, 'xenon bible set <id or name> <field> <value>');
  if (field === 'status' && !Xenon.statuses.includes(value)) throw new Error(`Use a status: ${Xenon.statuses.join(', ')}.`);
  if (field === 'aliases') value = value.split(',').map(item => item.trim()).filter(Boolean);
  if (field === 'references') value = value.split('\n').map(item => item.trim()).filter(Boolean);
  if (field === 'metadata') value = JSON.parse(value);
  const updated = { ...entry, [field]: value };
  await saveBible(updated);
  editBible(updated);
  printTerminal(`Updated ${entry.id}.`);
}

async function terminalContext([action = 'show', ...args]) {
  if (action === 'budget' || action === 'preferences') {
    const field = byId(action === 'budget' ? 'context-budget' : 'writing-preferences');
    setTerminalField(field, terminalText(args, `xenon context ${action} <value>`));
    await saveContextSettings();
    return printTerminal(`Context ${action} saved.`);
  }
  await flushEditor();
  if (['pin', 'exclude', 'auto'].includes(action)) {
    const id = args[0];
    if (!id) throw new Error('Use xenon context list for source IDs.');
    const item = captureOperation().context.candidates.find(candidate => candidate.id === id);
    if (item?.required) throw new Error('This source is required.');
    if (!item && !Object.hasOwn(xenonData.contextPolicy, id) && !recordArray.some(record => record.id === id) && !xenonData.bible.some(entry => entry.id === id)) throw new Error('Context source not found.');
    await saveContextPolicy(id, action === 'auto' ? '' : action);
  } else if (!['show', 'list', 'rebuild'].includes(action)) throw new Error('Unknown context action. Use xenon help.');
  const run = captureOperation();
  inspectContext(run);
  const summary = byId('context-summary').textContent;
  if (action === 'show') return printTerminal(`${summary}\n${byId('context-output').textContent}`);
  printTerminal(`${summary}\n${run.context.candidates.map(item => `${item.id} · ${run.context.selected.includes(item) ? 'included' : 'omitted'} · ${item.label}`).join('\n')}`);
}

async function terminalJobs([action = 'list', id]) {
  if (action === 'start') {
    if (id && !Object.hasOwn(Xenon.operations, id)) throw new Error('Unknown writing operation.');
    return startBackgroundJob(id);
  }
  if (action === 'cancel') {
    if (!id) throw new Error('Supply a job ID.');
    await cancelGeneration(id);
    return printTerminal(`Cancellation requested for ${id}.`);
  }
  const jobs = await jobsList();
  if (action === 'list') return printTerminal(jobs.map(job => `${job.id} ${job.status} ${job.label || job.operation || ''}`).join('\n') || 'No jobs.');
  if (!['show', 'review'].includes(action)) throw new Error('Use xenon jobs list, start, show, review, or cancel.');
  const job = jobs.find(item => item.id === id);
  if (!job) throw new Error('Job not found.');
  if (action === 'review') {
    if (!job.content) throw new Error('This job has no output to review.');
    reviewJob(job);
  }
  printTerminal([`${job.id} · ${job.status}`, job.error, job.content, action === 'review' && 'Use preview accept, show, or export.'].filter(Boolean).join('\n'));
}
