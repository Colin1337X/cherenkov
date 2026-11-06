/* Xenon extends the existing Cherenkov editor and terminal. No module loader/build required. */
'use strict';
const byId = id => document.getElementById(id);
let autosaveTimer, editorDirty = false, editorSaveQueue = Promise.resolve();
let activeOperation, legacyController, legacyQueueController, preview, lastRun, lastEditorText = '';
let lastBibleBook;
let customCss = '';
const safeCssMode = new URLSearchParams(location.search).has('safe-css');
const editHistory = new Map();
const browserJobs = new Map();

function warn(message) {
  const element = byId('storage-warning');
  element.hidden = false;
  if (!element.textContent.includes(message)) element.textContent += (element.textContent ? '\n' : '') + message;
}
function reportStorageError(error) { warn(error.message || String(error)); setSaveStatus('save failed — export'); }
function guarded(fn) {
  return async event => { try { await fn(event); } catch (error) { printTerminal(error.message || String(error), 'error'); if (workspaceStorage?.failed) reportStorageError(error); } };
}
function bind(id, fn, event = 'click') { byId(id).addEventListener(event, guarded(fn)); }
function button(label, fn) { const element = document.createElement('button'); element.type = 'button'; element.className = 'quiet-button'; element.textContent = label; element.addEventListener('click', guarded(fn)); return element; }
function textNode(tag, text) { const element = document.createElement(tag); element.textContent = text; return element; }

async function initializeXenonStorage() {
  workspaceStorage = await XenonStorage.open({ onWarning: warn });
  applyWorkspace(workspaceStorage.data);
  if (workspaceStorage.mode === 'localStorage') warn('OPFS is unavailable; browser localStorage has limited space. Export backups regularly.');
}

function isCherenkovMode() {
  return document.body.classList.contains('cherenkov-mode');
}

function applyWorkspaceMode(mode) {
  const pure = mode === 'cherenkov';
  document.body.classList.toggle('cherenkov-mode', pure);
  byId('workspace-mode').value = pure ? 'cherenkov' : 'xenon';
  byId('workspace-name').textContent = pure ? 'cherenkov' : 'xenon';
  byId('workspace-tagline').textContent = pure ? 'story workspace' : 'the Cherenkov creative writing workspace';
  document.title = pure ? 'Cherenkov · Story workspace' : 'Xenon · Cherenkov writing workspace';
  const storage = workspaceStorage.mode === 'node' ? 'Node filesystem' : workspaceStorage.mode;
  byId('runtime-status').textContent = `${pure ? 'Cherenkov' : 'Xenon'} · ${storage} storage · schema ${Xenon.SCHEMA}`;
  renderPreview();
}
function setWorkspaceMode(mode) {
  if (!['xenon', 'cherenkov'].includes(mode)) throw new Error('Use mode xenon or mode cherenkov.');
  applyWorkspaceMode(mode);
  XenonStorage.settings.setItem('xenon-workspace-mode', mode);
}
function applyCustomCss(css) {
  customCss = css;
  byId('workspace-custom-css').textContent = safeCssMode ? '' : css;
  byId('custom-css').value = css;
  const status = safeCssMode ? 'Safe CSS mode is active. Remove ?safe-css=1 to apply saved styles.'
    : css ? 'Custom CSS applied.' : 'Default styling is active.';
  byId('custom-css-status').textContent = status;
  return status;
}
function saveCustomCss(css) {
  if (css.length > byId('custom-css').maxLength) throw new Error('Custom CSS is limited to 65,536 characters.');
  if (css) XenonStorage.settings.setItem('xenon-custom-css', css);
  else XenonStorage.settings.removeItem('xenon-custom-css');
  return applyCustomCss(css);
}
function applyWorkspace(data) {
  xenonData = Xenon.clone(data);
  recordArray = xenonData.records;
  recordDirectory = XenonStorage.memoryDirectory(recordArray);
  for (const [key, value] of Object.entries({ config: JSON.stringify(data.config), trackers: JSON.stringify(data.trackers || []), siteColor: data.siteColor || 'cyan' })) XenonStorage.settings.setItem(key, value);
}
function cleanExport(data) {
  const copy = Xenon.clone(data);
  if (copy.config) delete copy.config.apiKey;
  for (const profile of copy.profiles || []) delete profile.apiKey;
  delete copy.storageVersion;
  return copy;
}
function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function historyFor(record) {
  if (!editHistory.has(record.id)) editHistory.set(record.id, { past: [], future: [] });
  return editHistory.get(record.id);
}
function markEdit(previous = lastEditorText) {
  editorEpoch++;
  if (currentRecord?.type === 'scene') {
    const history = historyFor(currentRecord);
    if (previous !== mainEditor.value && history.past.at(-1) !== previous) history.past.push(previous);
    history.future = [];
  }
  lastEditorText = mainEditor.value;
  editorDirty = true; setSaveStatus('unsaved'); renderUiState();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => flushEditor().catch(reportStorageError), 650);
}
function flushEditor() {
  clearTimeout(autosaveTimer);
  // Capture before awaiting so rapid navigation cannot save a different scene's text.
  const record = currentRecord, text = mainEditor.value, overrides = record ? readCreativeOverrides() : null, epoch = editorEpoch;
  const operation = editorSaveQueue.then(async () => {
    if (!editorDirty && saveStatusElement.dataset.state !== 'unsaved') return;
    if (!record) {
      xenonData.scratch = text;
      await persistUserJson();
      if (epoch === editorEpoch) { editorDirty = false; setSaveStatus(workspaceStorage.mode === 'memory' ? 'session only — export' : 'scratch saved'); }
      return;
    }
    if (record.type === 'scene') record.content = text;
    record.creativeControls = overrides;
    record.updatedAt = new Date().toISOString();
    await saveRecord(recordDirectory, record);
    recordArray = await loadAllRecords(recordDirectory);
    await persistUserJson();
    if (currentRecord?.id === record.id && epoch === editorEpoch) { currentRecord = findRecord(record.id); editorDirty = false; setSaveStatus(workspaceStorage.mode === 'memory' ? 'session only — export' : 'saved'); }
    renderXenon();
  });
  editorSaveQueue = operation.catch(() => {}); return operation;
}
async function undoEdit(redo = false) {
  if (currentRecord?.type !== 'scene' || mainEditor.readOnly) return;
  const history = historyFor(currentRecord), from = redo ? history.future : history.past, to = redo ? history.past : history.future;
  if (!from.length) return;
  to.push(mainEditor.value); mainEditor.value = from.pop(); lastEditorText = mainEditor.value;
  editorEpoch++; editorDirty = true; setSaveStatus('unsaved'); renderUiState(); await flushEditor();
  return true;
}
async function updateManuscript(text) {
  if (mainEditor.readOnly || (currentRecord && currentRecord.type !== 'scene')) throw new Error('Load a scene or use the scratchpad first.');
  if (mainEditor.value === text) return false;
  const previous = mainEditor.value;
  mainEditor.value = text;
  markEdit(previous);
  await flushEditor();
  return true;
}
async function openScratchpad() {
  await executeCommand({ cmd: 'load', args: ['/'], flags: [] });
  mainEditor.value = xenonData.scratch || '';
  lastEditorText = mainEditor.value;
  renderUiState();
}
async function navigateScene(delta) {
  const scenes = getScenesUnder(getBook() || '/');
  const index = scenes.findIndex(record => record.id === currentRecord?.id);
  const scene = scenes[index + delta];
  if (scene) await executeCommand({ cmd: 'load', args: [scene.id], flags: [] });
  return scene;
}
function setFocusMode(enabled) {
  document.body.classList.toggle('focus-mode', enabled);
  byId('focus-mode').setAttribute('aria-pressed', String(enabled));
}
function findEditorText(needle) {
  const afterSelection = mainEditor.value.indexOf(needle, mainEditor.selectionEnd);
  return afterSelection < 0 ? mainEditor.value.indexOf(needle) : afterSelection;
}
function searchProject(needle) {
  return recordArray.filter(record => record.type === 'scene' && record.content.includes(needle));
}
// One dispatch path is used by the original shell, new terminal commands, and GUI navigation.
async function executeCommand(command) {
  if (command.cmd === 'xenon') {
    if (isCherenkovMode()) return printTerminal('Choose Xenon in Workspace mode to use xenon commands.', 'error');
    return xenonCommand(command);
  }
  if (Object.hasOwn(workspaceTerminalCommands, command.cmd)) return workspaceTerminalCommands[command.cmd](command);
  if (command.cmd === 'tracker' && ['get', 'set'].includes(command.args[0])) return terminalTrackerValue(command.args);
  const generation = ['generate', 'gen', 'g'].includes(command.cmd);
  if (generation && (activeOperation || legacyQueueController)) throw new Error('Finish or cancel the current generation first.');
  await flushEditor();
  if (['rm', 'rmdir', 'delete', 'del', 'd', 'erase', 'mv', 'move'].includes(command.cmd)) {
    if (workspaceStorage.mode === 'memory') download('xenon-before-change.json', cleanExport(buildUserData()));
    else await workspaceStorage.backup(buildUserData());
  }
  if (generation) legacyQueueController = new AbortController();
  try { return await executeCherenkovCommand(command); }
  finally { if (generation) legacyQueueController = null; lastEditorText = mainEditor.value; renderUiState(); renderXenon(); }
}
function importWorkspaceText(text) {
  if (new Blob([text]).size > 25_000_000) throw new Error('Import exceeds 25 MB.');
  return mergeWorkspace(JSON.parse(text));
}
async function mergeWorkspace(input) {
  const incoming = Xenon.migrate(input);
  await flushEditor();
  if (workspaceStorage.mode === 'memory') download('xenon-before-import.json', cleanExport(buildUserData()));
  else await workspaceStorage.backup(buildUserData());
  const before = buildUserData(), merged = Xenon.clone(before), renames = new Map(), idMap = new Map();
  for (const folder of incoming.records.filter(r => r.type === 'folder')) {
    if (incoming.records.some(r => Xenon.inside(r.path, folder.path) && before.records.some(old => old.path === r.path || old.id === r.id))) {
      let target = folder.path + '-import', number = 2;
      while ([...before.records, ...incoming.records].some(r => Xenon.inside(r.path, target))) target = folder.path + '-import-' + number++;
      renames.set(folder.path, target);
    }
  }
  const remap = value => {
    for (const [old, next] of renames) if (Xenon.inside(value, old)) return next + value.slice(old.length);
    return idMap.get(value) || value;
  };
  for (const record of incoming.records) if (before.records.some(r => r.id === record.id)) idMap.set(record.id, Xenon.uid());
  for (const record of incoming.records) {
    record.id = idMap.get(record.id) || record.id;
    record.path = remap(record.path); record.parentPath = remap(record.parentPath); record.name = record.path.split('/').at(-1);
    merged.records.push(record);
  }
  for (const entry of incoming.bible) {
    if (merged.bible.some(e => e.id === entry.id)) entry.id = Xenon.uid();
    entry.book = remap(entry.book); entry.references = entry.references.map(remap); merged.bible.push(entry);
  }
  for (const tracker of incoming.trackers) {
    const copy = { ...tracker, path: remap(tracker.path) };
    if (!merged.trackers.some(t => t.name === copy.name && t.path === copy.path)) merged.trackers.push(copy);
  }
  if (!before.records.length) {
    const handled = new Set(['records', 'bible', 'trackers', 'config', 'siteColor', 'profiles', 'storageVersion', 'exportedAt', 'scratch', 'trash']);
    for (const [key, value] of Object.entries(incoming)) if (!handled.has(key)) merged[key] = Xenon.clone(value);
    merged.config = incoming.config; merged.siteColor = incoming.siteColor; merged.profiles = incoming.profiles;
  }
  if (incoming.scratch && incoming.scratch !== before.scratch) merged.scratch = [before.scratch, incoming.scratch].filter(Boolean).join('\n\n--- Imported scratchpad ---\n\n');
  if (incoming.trash?.length) merged.trash = [...(merged.trash || []), ...incoming.trash.map(record => ({ ...record, path: remap(record.path), parentPath: remap(record.parentPath || '/') }))];
  merged.contextPolicy = { ...Object.fromEntries(Object.entries(incoming.contextPolicy).map(([id, value]) => [idMap.get(id) || id, value])), ...merged.contextPolicy };
  const validated = Xenon.migrate(merged);
  await workspaceStorage.save(validated); // Commit before changing the live editor.
  applyWorkspace(validated); loadConfig(); trackerDefinitions = loadTrackerDefinitions(); setSiteColor(validated.siteColor || 'cyan', false);
  currentRecord = null; currentPath = '/'; batchLoadedScenes = []; creativeOverrideIds.clear(); mainEditor.value = ''; mainEditor.readOnly = false;
  editorDirty = false; lastEditorText = ''; showCreativeControls(globalCreativeControls); renderUiState(); renderXenon(); refreshProfileOptions();
  byId('writing-preferences').value = xenonData.preferences || ''; byId('context-budget').value = xenonData.contextBudget || 6000;
  const profile = xenonData.profiles.find(p => p.id === xenonData.activeProfile);
  if (profile) { byId('endpoint-profile').value = profile.id; applyProfile(profile); }
  printTerminal(`Imported ${incoming.records.length} records. Existing records preserved${renames.size ? '; colliding folders renamed with -import' : ''}.`);
}
function getBook() { return currentRecord && currentRecord.path.split('/').filter(Boolean).length >= 2 ? Xenon.bookPath(currentRecord.path) : null; }
function renderNavigation() {
  const nav = byId('project-navigation'); if (!nav) return;
  const sorted = [];
  function visit(parent) { for (const record of recordArray.filter(r => r.parentPath === parent).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))) { sorted.push(record); if (record.type !== 'scene') visit(record.path); } }
  visit('/');
  nav.replaceChildren(...sorted.map(record => {
    const element = button(`${record.type === 'scene' ? '·' : '▸'} ${record.name}`, () => executeCommand({ cmd: 'load', args: [record.id], flags: [] }));
    element.style.paddingLeft = (8 + (record.path.split('/').length - 2) * 12) + 'px';
    element.title = record.path; element.setAttribute('aria-current', currentRecord?.id === record.id ? 'true' : 'false');
    return element;
  }));
}
function renderBible() {
  const book = getBook();
  if (lastBibleBook !== book) { editBible(); lastBibleBook = book; }
  byId('bible-scope').textContent = book ? `Book: ${book}` : 'Select a book, chapter, or scene.';
  byId('bible-list').replaceChildren(...xenonData.bible.filter(e => e.book === book || e.book === '/').map(entry => button(`${entry.name} · ${entry.type} · ${entry.status}`, () => editBible(entry))));
}
function editBible(entry) {
  byId('bible-id').value = entry?.id || '';
  byId('bible-type').value = entry?.type || 'character'; byId('bible-status').value = entry?.status || 'draft';
  for (const name of ['name', 'description']) byId('bible-' + name).value = entry?.[name] || '';
  byId('bible-aliases').value = (entry?.aliases || []).join(', ');
  byId('bible-metadata').value = JSON.stringify(entry?.metadata || {}, null, 2);
  byId('bible-references').value = (entry?.references || []).join('\n');
}
async function saveBible(entry) {
  const normalized = Xenon.normalizeBible(entry), index = xenonData.bible.findIndex(e => e.id === normalized.id);
  if (index < 0) xenonData.bible.push(normalized); else xenonData.bible[index] = normalized;
  await persistUserJson(); renderBible();
}
function renderRevisions() {
  const list = byId('revision-list');
  list.replaceChildren(...(currentRecord?.revisions || []).slice().reverse().map(revision => {
    const row = document.createElement('div'); row.className = 'toolbar';
    row.append(button(`${revision.at || 'saved'} · ${revision.reason || 'edit'}`, () => {
      byId('revision-before').textContent = revision.content; byId('revision-after').textContent = mainEditor.value;
    }), button('restore', async () => {
      if (currentRecord?.type === 'scene') await updateManuscript(revision.content);
    })); return row;
  }));
}
function renderXenon() {
  if (!byId('project-navigation') || !workspaceStorage) return;
  renderNavigation(); renderBible(); renderRevisions();
}
function getActiveProfile() {
  const capabilities = { temperature: byId('cap-temperature').checked, top_p: byId('cap-top-p').checked,
    presence_penalty: byId('cap-presence').checked, reasoning_effort: byId('cap-reasoning').checked,
    usage: byId('cap-usage').checked, tokenField: byId('token-field').value };
  return { endpoint: endpointInput.value, apiKey: apiKeyInput.value, model: modelInput.value, capabilities,
    proxy: workspaceStorage?.mode === 'node' && byId('use-proxy').checked, serverProfile: byId('server-profile').value || 'default',
    timeoutSeconds: Number(byId('request-timeout').value) || 120, retries: Number(byId('retry-count').value) || 0 };
}
function refreshProfileOptions() {
  byId('endpoint-profile').replaceChildren(new Option('current settings', ''), ...xenonData.profiles.map(p => new Option(p.name, p.id)));
}
function applyProfile(profile) {
  endpointInput.value = profile.endpoint || ''; apiKeyInput.value = profile.apiKey || ''; modelInput.value = profile.model || '';
  byId('use-proxy').checked = Boolean(profile.proxy); byId('server-profile').value = profile.serverProfile || 'default';
  byId('profile-name').value = profile.name || '';
  const map = { temperature: 'cap-temperature', top_p: 'cap-top-p', presence_penalty: 'cap-presence', reasoning_effort: 'cap-reasoning', usage: 'cap-usage' };
  for (const [key, id] of Object.entries(map)) byId(id).checked = profile.capabilities?.[key] !== false;
  byId('token-field').value = profile.capabilities?.tokenField || 'max_tokens';
  byId('request-timeout').value = profile.timeoutSeconds ?? 120;
  byId('retry-count').value = profile.retries ?? 0;
}
function loadOperationModel() {
  byId('operation-model').value = xenonData.operationModels?.[byId('writing-operation').value] || '';
}
async function saveOperationModel() {
  xenonData.operationModels ||= {};
  xenonData.operationModels[byId('writing-operation').value] = byId('operation-model').value;
  await persistUserJson();
}
async function selectEndpointProfile(id) {
  const profile = xenonData.profiles.find(item => item.id === id);
  if (id && !profile) throw new Error('Profile not found.');
  if (profile) applyProfile(profile);
  byId('endpoint-profile').value = profile?.id || '';
  xenonData.activeProfile = profile?.id || '';
  await saveConfig();
}
async function saveEndpointProfile(name) {
  name = name.trim();
  if (!name) throw new Error('Give the endpoint profile a name.');
  const existing = xenonData.profiles.find(profile => profile.id === xenonData.activeProfile);
  const profile = { ...getActiveProfile(), id: existing?.id || Xenon.uid(), name };
  if (existing) Object.assign(existing, profile); else xenonData.profiles.push(profile);
  xenonData.activeProfile = profile.id;
  await saveConfig();
  refreshProfileOptions();
  byId('endpoint-profile').value = profile.id;
  return profile;
}
function captureOperation(operation = byId('writing-operation').value, instructions, record = currentRecord) {
  if (record?.type !== 'scene') throw new Error('Load a scene first.');
  const isCurrent = record.id === currentRecord?.id;
  const text = isCurrent ? mainEditor.value : record.content;
  const start = isCurrent ? mainEditor.selectionStart : 0, end = isCurrent ? mainEditor.selectionEnd : text.length;
  const hasSelection = end > start;
  const source = byId('writing-input').value || (hasSelection ? text.slice(start, end) : text);
  const objective = instructions ?? [operation === 'rewrite' ? byId('rewrite-preset').value : '', byId('writing-instructions').value].filter(Boolean).join('\n');
  const controls = isCurrent ? readCreativeControls() : resolveCreativeControls(record);
  const context = Xenon.selectContext({ records: recordArray, bible: xenonData.bible, scene: record, input: source, instructions: objective, controls,
    preferences: [byId('writing-preferences').value, resolveCustomContextSources(controls['custom-context-sources'])].filter(Boolean).join('\n'),
    budget: Number(byId('context-budget').value), policy: xenonData.contextPolicy });
  const profile = getActiveProfile();
  const operationModel = operation === byId('writing-operation').value ? byId('operation-model').value : xenonData.operationModels?.[operation];
  profile.model = operationModel || profile.model;
  return { operation, input: source, instructions: objective, context, profile, params: getGenerationParams(controls),
    snapshot: { id: record.id, version: record.version || 0, content: text, epoch: editorEpoch, start: hasSelection ? start : 0, end: hasSelection ? end : text.length },
    path: record.path, book: Xenon.bookPath(record.path), count: Math.max(1, Math.min(5, Number(byId('candidate-count').value) || 1)), system: systemPromptInput.value };
}
async function saveContextSettings() {
  xenonData.preferences = byId('writing-preferences').value;
  xenonData.contextBudget = Number(byId('context-budget').value);
  await persistUserJson();
}
async function saveContextPolicy(id, value) {
  xenonData.contextPolicy = { ...xenonData.contextPolicy, [id]: value };
  await persistUserJson();
}
function inspectContext(run = captureOperation()) {
  byId('context-summary').textContent = `${run.context.used}/${run.context.budget} estimated source tokens. ${run.context.omitted.length} sources omitted.${run.context.blocked ? ' Important or pinned context does not fit; generation blocked.' : ''}`;
  byId('context-entries').replaceChildren(...run.context.candidates.map(item => {
    const label = textNode('label', `${run.context.selected.includes(item) ? 'Included' : 'Omitted'} · ${item.label} · ~${item.tokens} tokens`);
    const select = document.createElement('select'); select.className = 'input-field';
    select.replaceChildren(new Option('automatic', ''), new Option('pin', 'pin'), new Option('exclude', 'exclude'));
    select.value = xenonData.contextPolicy[item.id] || ''; select.disabled = item.required;
    select.addEventListener('change', guarded(async () => { await saveContextPolicy(item.id, select.value); inspectContext(); }));
    label.append(select); return label;
  }));
  byId('context-output').textContent = run.context.blocked ? run.context.text : JSON.stringify(Xenon.prompt(run), null, 2);
}
function selectedCandidate() { return preview?.candidates[Number(byId('candidate-select').value) || 0]; }
function renderPreview() {
  byId('preview-panel').hidden = !preview || (isCherenkovMode() && !preview.run.legacy);
  if (!preview) return;
  const candidate = selectedCandidate();
  byId('generation-preview').value = candidate?.content || '';
  byId('preview-reasoning').textContent = candidate?.reasoning || '';
  byId('preview-source').textContent = preview.run.input;
  const analysis = ['critique', 'brainstorm', 'extract', 'continuity'].includes(preview.run.operation);
  const disabled = Boolean(activeOperation || !candidate?.content || analysis);
  byId('accept-candidate').disabled = disabled; byId('append-candidate').disabled = disabled;
  byId('regenerate-candidate').disabled = Boolean(preview.run.legacy || activeOperation);
  byId('accept-candidate').textContent = preview.run.operation === 'continue' ? 'accept continuation' : 'accept replacement';
}
function makePreview(run) {
  preview = { run, candidates: [] }; byId('extraction-review').replaceChildren();
  byId('candidate-select').replaceChildren(); renderPreview();
}
async function runWriting(run, onUpdate) {
  if (activeOperation || legacyQueueController) throw new Error('Cancel or finish the current generation first.');
  await flushEditor();
  run ||= captureOperation();
  // Refresh version after flushing unsaved text while preserving the selected input/range.
  const latest = findRecord(run.snapshot.id);
  if (latest?.content !== run.snapshot.content) throw new Error('The scene changed. Start a new operation.');
  run.snapshot.version = latest.version || 0;
  const messages = Xenon.prompt(run);
  inspectContext(run); lastRun = run; makePreview(run);
  const controller = new AbortController(); activeOperation = controller;
  const job = { id: Xenon.uid(), operation: run.operation, status: 'running' }; browserJobs.set(job.id, job);
  try {
    for (let index = 0; index < run.count; index++) {
      controller.signal.throwIfAborted();
      const candidate = { content: '', reasoning: '' }; preview.candidates.push(candidate);
      byId('candidate-select').append(new Option(`Candidate ${index + 1}`, String(index))); byId('candidate-select').value = String(index);
      const startedAt = performance.now();
      const output = await XenonProviders.complete({ profile: run.profile, messages, params: run.params, signal: controller.signal,
        timeout: Number(byId('request-timeout').value) * 1000, retries: Number(byId('retry-count').value),
        onUpdate(update) {
          Object.assign(candidate, update); renderPreview();
          onUpdate?.(update, index);
          const metrics = measureCompletion(update.content, update.reasoning, update.usage, startedAt);
          byId('preview-status').textContent = `Streaming candidate ${index + 1}/${run.count} · ${metrics.tokensPerSecond.toFixed(1)} tok/s`;
        } });
      Object.assign(candidate, output);
      byId('preview-status').textContent = `Candidate ${index + 1}/${run.count} ready · ${output.metrics.completionTokens} tokens · ${output.metrics.tokensPerSecond.toFixed(1)} tok/s`;
    }
    job.status = 'completed';
    if (run.operation === 'extract') renderExtraction();
  } catch (error) { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; byId('preview-status').textContent = `${error.message || 'Cancelled.'} Partial output remains reviewable.`; }
  finally { activeOperation = null; renderPreview(); }
}
function rejectCandidate() {
  if (activeOperation) { cancelGeneration(); return; }
  preview = null;
  renderPreview();
}
function regenerateCandidate(onUpdate) {
  if (preview?.run.legacy) throw new Error('Use generate to rerun legacy generation.');
  if (!lastRun) throw new Error('Generate a Xenon candidate first.');
  return runWriting(captureOperation(lastRun.operation, lastRun.instructions), onUpdate);
}
async function copyCandidate() {
  const content = selectedCandidate()?.content;
  if (!content) throw new Error('No candidate selected.');
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(content); return; } catch { /* Try the local copy command. */ }
  }
  const field = document.createElement('textarea');
  field.value = content;
  field.className = 'clipboard-buffer';
  const previous = document.activeElement;
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable. Use preview export or copy the displayed text.');
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}
async function acceptCandidate(mode) {
  if (activeOperation) throw new Error('Finish or cancel streaming before accepting.');
  const candidate = selectedCandidate(); if (!candidate?.content) return;
  const run = preview.run;
  if (['critique', 'brainstorm', 'extract', 'continuity'].includes(run.operation)) throw new Error('Use Copy or Export for analysis and idea output.');
  if (currentRecord?.id !== run.snapshot.id || editorEpoch !== run.snapshot.epoch || mainEditor.value !== run.snapshot.content) throw new Error('The editor changed since this preview. Copy the result or regenerate.');
  await flushEditor();
  const record = findRecord(run.snapshot.id);
  Xenon.accept(record, run.snapshot, candidate.content, mode || (run.operation === 'continue' ? 'append' : 'replace'));
  const previous = mainEditor.value;
  currentRecord = record; mainEditor.value = record.content; markEdit(previous);
  await saveRecord(recordDirectory, record); await flushEditor();
  byId('preview-status').textContent = 'Accepted. The previous text is available in Draft history and Undo.';
  renderRevisions(); preview = null; renderPreview();
}
function showLegacyCandidate(record, generation) {
  const run = captureOperation('draft', '', findRecord(record.id));
  run.legacy = true;
  makePreview(run);
  preview.candidates.push(generation); byId('candidate-select').append(new Option('Preserved generation', '0')); renderPreview();
}
function extractionCandidates() {
  const candidate = selectedCandidate();
  if (!candidate || preview.run.operation !== 'extract') throw new Error('Run xenon extract first.');
  return candidate.entries ??= Xenon.extractCandidates(candidate.content, preview.run.book, preview.run.path);
}
async function acceptExtraction(index) {
  const entry = extractionCandidates()[index];
  if (!entry) throw new Error('Extraction entry not found.');
  await saveBible(entry);
  return entry;
}
function renderExtraction() {
  const entries = extractionCandidates();
  byId('extraction-review').replaceChildren(...entries.map((entry, index) => {
    const section = document.createElement('section'); section.append(textNode('h3', entry.name + ' · ' + entry.type), textNode('p', entry.description));
    section.append(button('accept as draft', async event => { await acceptExtraction(index); event.target.disabled = true; event.target.textContent = 'saved as draft'; })); return section;
  }));
}
function cancelGeneration(id) {
  if (!id || browserJobs.has(id)) { activeOperation?.abort(new Error('Generation cancelled.')); legacyQueueController?.abort(new Error('Generation cancelled.')); legacyController?.abort(new Error('Generation cancelled.')); return; }
  if (workspaceStorage.mode === 'node') return fetch('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }).then(r => { if (!r.ok) throw new Error('Cancel failed.'); });
  throw new Error('Unknown job.');
}
function checkContinuity(scope = getBook() || '/') {
  const findings = Xenon.continuity(recordArray, xenonData.bible, scope);
  byId('continuity-results').textContent = findings.length ? JSON.stringify(findings, null, 2) : 'No structured-rule conflicts found. This checks canon metadata alive:false and forbiddenPhrases; use the continuity AI operation for broader analysis. Findings require human review.';
  return findings;
}
async function jobsList() {
  let jobs = [...browserJobs.values()];
  if (workspaceStorage.mode === 'node') { const response = await fetch('/api/jobs'); if (!response.ok) throw new Error('Jobs could not be read.'); jobs = jobs.concat(await response.json()); }
  byId('jobs-list').replaceChildren(...jobs.map(job => {
    const row = document.createElement('div'); row.append(textNode('p', `${job.id} · ${job.status} · ${job.label || job.operation || ''}`));
    if (job.status === 'running') row.append(button('cancel', () => cancelGeneration(job.id)));
    if (job.content) row.append(button('review output', () => reviewJob(job)));
    return row;
  })); return jobs;
}
function reviewJob(job) {
  if (activeOperation || legacyQueueController) throw new Error('Finish or cancel the active generation first.');
  const operation = job.label?.split(' ')[0];
  const run = captureOperation(Object.hasOwn(Xenon.operations, operation) ? operation : 'draft');
  makePreview(run);
  preview.candidates.push({ content: job.content, reasoning: job.reasoning || '' });
  byId('candidate-select').append(new Option('Job output', '0'));
  byId('preview-status').textContent = 'Background output. Review before applying to this scene.';
  renderPreview();
}
async function startBackgroundJob(operation) {
  if (workspaceStorage.mode !== 'node') throw new Error('Persistent background jobs require Node mode. Browser generation works while the page remains open.');
  await flushEditor(); const run = captureOperation(operation);
  if (!run.profile.proxy) throw new Error('Choose a Node server profile for background jobs.');
  const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: run.profile.serverProfile,
    body: XenonProviders.requestBody(run.profile, Xenon.prompt(run), run.params), label: run.operation + ' ' + run.path }) });
  if (!response.ok) throw new Error('Job could not start. Check the server profile and active requests.');
  const job = await response.json(); printTerminal(`Started job ${job.id}. Use xenon jobs to review it.`); await jobsList();
  return job;
}
async function makeWorkspaceBackup() {
  await flushEditor();
  if (workspaceStorage.mode === 'memory') {
    download('xenon-backup.json', cleanExport(buildUserData()));
    printTerminal('Downloaded a workspace backup.');
  } else printTerminal('Backup saved: ' + await workspaceStorage.backup(buildUserData()));
}
async function restoreTrash() {
  if (!xenonData.trash?.length) return printTerminal('No deleted records.');
  const newest = new Map(xenonData.trash.map(record => [record.path, record]));
  const records = [...newest.values()].map(({ deletedAt, ...record }) => Xenon.clone(record));
  for (const record of recordArray) {
    if (records.some(item => Xenon.inside(item.path, record.path)) && !records.some(item => item.path === record.path)) records.push(Xenon.clone(record));
  }
  await mergeWorkspace({ records, config: {}, schemaVersion: 2 });
}
async function showBackups() {
  const list = byId('backups-list'); list.hidden = false;
  const names = await workspaceStorage.listBackups();
  list.replaceChildren(textNode('p', 'Recovery imports a backup alongside current records. Collisions are renamed; current work is preserved.'), ...names.map(name => {
    const row = document.createElement('div'); row.className = 'toolbar';
    row.append(button('recover ' + name, async () => mergeWorkspace(await workspaceStorage.readBackup(name))), button('download', async () => download(name, cleanExport(await workspaceStorage.readBackup(name))))); return row;
  }));
  if (!names.length) list.append(textNode('p', 'No persistent backups yet. Use Export for a portable copy.'));
}

function setupTerminalAccess() {
  const toggle = byId('toggle-terminal');
  let previousFocus;

  function toggleTerminal() {
    const opening = terminalContent.hidden;
    const focusInTerminal = terminalContent.contains(document.activeElement);
    if (opening) previousFocus = document.activeElement;
    terminalContent.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.textContent = opening ? 'Close terminal' : 'Terminal';

    if (opening) {
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
      const prompt = terminalContent.querySelector('.terminal-prompt input, .terminal-prompt textarea');
      (prompt || (commandInput.disabled ? terminalOutput : commandInput)).focus({ preventScroll: true });
    } else if (focusInTerminal) {
      previousFocus?.focus({ preventScroll: true });
      if (document.activeElement === document.body) toggle.focus({ preventScroll: true });
    }
  }

  toggle.addEventListener('click', toggleTerminal);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.target.closest?.('dialog[open]')) return;
    const shortcut = event.ctrlKey && event.code === 'Backquote' && !event.metaKey && !event.shiftKey && !event.altKey;
    const dismiss = event.key === 'Escape' && !terminalContent.hidden && toggle.closest('.terminal-shell').contains(document.activeElement)
      && !activeOperation && !legacyQueueController;
    if (!shortcut && !dismiss) return;
    event.preventDefault();
    if (!event.repeat) toggleTerminal();
  });
}

async function setupXenon() {
  applyWorkspaceMode(XenonStorage.settings.getItem('xenon-workspace-mode'));
  bind('workspace-mode', event => setWorkspaceMode(event.target.value), 'change');
  applyCustomCss(XenonStorage.settings.getItem('xenon-custom-css') || '');
  bind('custom-css-form', event => {
    event.preventDefault();
    saveCustomCss(byId('custom-css').value);
  }, 'submit');
  bind('reset-custom-css', () => saveCustomCss(''));
  for (const value of Xenon.kinds) byId('bible-type').append(new Option(value, value));
  for (const value of Xenon.statuses) byId('bible-status').append(new Option(value, value));
  editBible(); refreshProfileOptions();
  mainEditor.value = xenonData.scratch || ''; lastEditorText = mainEditor.value;
  byId('writing-preferences').value = xenonData.preferences || '';
  byId('context-budget').value = xenonData.contextBudget || 6000;
  loadOperationModel();
  if (xenonData.activeProfile) { const profile = xenonData.profiles.find(p => p.id === xenonData.activeProfile); if (profile) { byId('endpoint-profile').value = profile.id; applyProfile(profile); } }
  byId('use-proxy').disabled = workspaceStorage.mode !== 'node';
  const creativeControls = byId('creative-controls');
  for (const id of ['open-creative-controls', 'dock-creative-controls']) {
    bind(id, () => creativeControls.showModal());
  }
  bind('close-creative-controls', () => creativeControls.close());
  mainEditor.addEventListener('input', () => markEdit());
  creativeControls.addEventListener('input', () => { editorDirty = true; clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => flushEditor().catch(reportStorageError), 650); });
  window.addEventListener('beforeunload', event => { if (editorDirty || workspaceStorage.failed || activeOperation || legacyQueueController || preview?.candidates.some(c => c.content) || document.querySelector('.terminal-prompt textarea')?.value || workspaceStorage.mode === 'memory' && (recordArray.length || mainEditor.value)) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('unhandledrejection', event => { event.preventDefault(); reportStorageError(event.reason || new Error('Operation failed.')); });
  setupTerminalAccess();
  document.addEventListener('keydown', guarded(async event => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && !terminalContent.hidden
      && (activeOperation || legacyQueueController) && !window.getSelection()?.toString()
      && !event.target.closest?.('.terminal-prompt')
      && (document.activeElement === document.body || terminalContent.contains(document.activeElement))) {
      event.preventDefault(); cancelGeneration(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); await executeCommand({ cmd: 'save', args: [], flags: [] }); }
    if (event.target === mainEditor && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); await undoEdit(event.key.toLowerCase() === 'y' || event.shiftKey); }
    if (event.key === 'Escape' && !creativeControls.open) { cancelGeneration(); setFocusMode(false); }
  }));
  bind('create-scene-form', async event => {
    event.preventDefault(); const path = byId('new-scene-path').value.trim();
    if (!Xenon.validPath(path) || inferType(path) !== 'scene') throw new Error('Use /folder/book/chapter/scene.');
    await executeCommand({ cmd: 'mkdir', args: [path.slice(0, path.lastIndexOf('/'))], flags: ['-p'] });
    await executeCommand({ cmd: 'touch', args: [path], flags: [] });
    mainEditor.focus();
  }, 'submit');
  bind('save-scene', () => executeCommand({ cmd: 'save', args: [], flags: [] }));
  bind('recover-scratch', async () => { await openScratchpad(); mainEditor.focus(); });
  bind('undo-edit', () => undoEdit()); bind('redo-edit', () => undoEdit(true));
  bind('previous-scene', () => navigateScene(-1));
  bind('next-scene', () => navigateScene(1));
  bind('focus-mode', () => setFocusMode(!document.body.classList.contains('focus-mode')));
  bind('find-next', () => {
    const needle = byId('search-text').value; if (!needle) return;
    const index = findEditorText(needle);
    if (index >= 0) { mainEditor.focus(); mainEditor.setSelectionRange(index, index + needle.length); } else printTerminal('No matches.');
  });
  bind('replace-one', async () => {
    if (currentRecord?.type !== 'scene' || mainEditor.readOnly || !byId('search-text').value) return;
    if (mainEditor.value.slice(mainEditor.selectionStart, mainEditor.selectionEnd) !== byId('search-text').value) throw new Error('Find and select a match first.');
    mainEditor.setRangeText(byId('replace-text').value, mainEditor.selectionStart, mainEditor.selectionEnd, 'select'); markEdit(); await flushEditor();
  });
  bind('replace-all', () => { const needle = byId('search-text').value; if (needle && currentRecord?.type === 'scene' && !mainEditor.readOnly) return updateManuscript(mainEditor.value.split(needle).join(byId('replace-text').value)); });
  bind('search-project', async () => {
    await flushEditor(); const needle = byId('search-text').value; if (!needle) return;
    byId('search-results').replaceChildren(...searchProject(needle).map(r => button(r.path, () => executeCommand({ cmd: 'load', args: [r.id], flags: [] }))));
  });
  bind('bible-form', async event => {
    event.preventDefault(); const old = xenonData.bible.find(e => e.id === byId('bible-id').value);
    if (!getBook()) throw new Error('Load a book or scene first.');
    await saveBible({ id: old?.id || Xenon.uid(), book: old?.book || getBook(), type: byId('bible-type').value, name: byId('bible-name').value,
      status: byId('bible-status').value, description: byId('bible-description').value, aliases: byId('bible-aliases').value.split(',').map(x => x.trim()).filter(Boolean),
      metadata: JSON.parse(byId('bible-metadata').value || '{}'), references: byId('bible-references').value.split('\n').filter(Boolean) }); editBible();
  }, 'submit');
  bind('bible-new', () => editBible()); bind('extract-bible', () => runWriting(captureOperation('extract')));
  bind('run-writing', () => runWriting()); bind('cancel-writing', () => cancelGeneration());
  bind('accept-candidate', () => acceptCandidate()); bind('append-candidate', () => acceptCandidate('append'));
  bind('reject-candidate', rejectCandidate);
  bind('regenerate-candidate', () => regenerateCandidate());
  bind('candidate-select', () => { renderPreview(); if (preview?.run.operation === 'extract' && !activeOperation) renderExtraction(); }, 'change');
  bind('copy-candidate', copyCandidate);
  bind('export-candidate', () => download('xenon-candidate.txt', selectedCandidate()?.content || '', 'text/plain'));
  bind('inspect-context', () => inspectContext());
  bind('writing-operation', loadOperationModel, 'change');
  bind('operation-model', saveOperationModel, 'change');
  for (const id of ['writing-preferences', 'context-budget']) bind(id, saveContextSettings, 'change');
  bind('check-continuity', async () => { await flushEditor(); checkContinuity(); });
  bind('start-job', () => startBackgroundJob()); bind('refresh-jobs', jobsList);
  bind('endpoint-profile', event => selectEndpointProfile(event.target.value), 'change');
  bind('save-profile', () => saveEndpointProfile(byId('profile-name').value));
  bind('make-backup', makeWorkspaceBackup);
  bind('show-backups', showBackups);
  bind('restore-trash', restoreTrash);
  renderXenon(); renderUiState();
  printTerminal(isCherenkovMode()
    ? 'Cherenkov ready. Type help for commands. Ctrl+S saves and Escape cancels generation.'
    : 'Xenon ready. Use help for Cherenkov commands and xenon help for writing tools. Ctrl+S saves; Ctrl+Z / Ctrl+Shift+Z undo and redo; Escape cancels generation.');
}

init().then(setupXenon).catch(error => { warn('Startup failed: ' + error.message + ' Existing storage has not been replaced.'); commandInput.disabled = true; console.error(error); });
