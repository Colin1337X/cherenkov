# Xenon

Xenon is a local-first, MIT-licensed creative writing extension of [Cherenkov](https://github.com/Colin1337X/cherenkov), by Colin Cho. It preserves Cherenkov's plain-text scene editor, shell, fixed story hierarchy, inherited creative controls, trackers, themes, streaming/reasoning and recursive generation, and adds a reviewed AI writing workflow.

**JavaScript, HTML, CSS and built-in Node APIs. Zero npm dependencies. No build, account, telemetry or required cloud service.**

## Run

**Raw HTML:** open `index.html` in a modern browser. Classic scripts load directly from disk. The editor, project navigation, scratchpad, Story Bible, writing tools, terminal and JSON import/export share the same code as Node mode. Storage tries OPFS, then localStorage, then session memory. The status banner identifies the actual backend and warns when persistence is unavailable. Browser/file-origin storage can be temporary: export backups before moving files, changing browsers or closing a private session.

Direct inference in raw HTML requires an OpenAI-compatible endpoint that accepts requests from the browser's file origin, including CORS/preflight. Browser security can prevent requests; Xenon reports failures. It does not bypass browser security. Browser API keys are accessible to that browser environment.

**Node mode (Node 22 or newer):**

```sh
node server.js
```

Open [Xenon on localhost](http://127.0.0.1:4173). No `npm install` is needed. `npm start` is equivalent. Node mode stores the portable workspace in `.xenon/workspace.json`; `.xenon/backups/` holds pre-write snapshots and `.xenon/jobs.json` holds background output/status. Those files and browser API keys are private data, excluded by `.gitignore` and never served as static assets. Keep backups outside the repository too.

The existing root `user.json` is read as an initial legacy source when no new workspace exists; it is never overwritten. **Run one server process per data directory.** Use `PORT` and `XENON_DATA_DIR` to choose another port/directory.

## First scene and writing tools

1. Enter `/folder/book/chapter/scene` in **Scene path**, then **create scene and parents**. Library buttons load a scene or a read-only container batch view. The scratchpad holds writing done before a scene is created; **scratchpad** returns to it.
2. Write in the editor. Edits autosave after a short pause where storage permits. Ctrl/Cmd+S saves; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo. Draft history compares and restores saved versions. Search/replace is literal text; project search opens matching scenes. Focus mode centers the editor; Escape exits it and cancels generation.
3. Open **generation settings**, set the endpoint (for example `http://127.0.0.1:8080/v1`), optional key and model, then save. Save named endpoint profiles for different providers. Model discovery uses `/models` when supported.
4. Select text or use the full scene. Choose Continue, Rewrite, Expand, Describe, Brainstorm, Critique or Draft. Rewrite has clarity, conciseness, description, dialogue, emotion, pacing, tone and custom presets. Supply an objective/outline/topic or explicit input. Set operation model, parameters and up to five sequential candidates as needed.
5. **generate preview** streams into a separate preview. Review candidates and reasoning, then accept, append, reject, regenerate, copy or export. Continue appends new prose; the other prose tools replace the captured selection/full scene unless Append is chosen. Analysis and brainstorm output use Copy/Export. Edits made during generation block acceptance until you regenerate or copy the candidate yourself.

Provider capabilities let you omit temperature, top-p, presence penalty, reasoning effort and streaming-usage fields, and choose `max_tokens` or `max_completion_tokens`. Configure timeouts and up to three retries before streaming; partial streams are never automatically retried. Usage and speed are shown in previews; inherited generation still shows its token-rate and reasoning indicators.

The seven writing tools, extraction, continuity analysis, multiple candidates and both networking paths are implemented and tested with mock inference. **No live model/provider verification is claimed.**

## Story Bible and context

Each book has characters, locations, organizations, world rules, relationships, timelines, plot threads, objects, events and lore. Entries have stable IDs, aliases, descriptions, source references, JSON metadata and a status: canon, draft, speculation, outdated or contradicted.

Edit entries manually or **extract candidates from scene**. Extraction is reviewable: accepting an entry stores a draft, which you can edit/promote to canon. AI output is never automatically canonical.

**Context inspector** shows source selection and generated messages before sending. It combines inherited global/folder/book/chapter/scene controls, ancestor premises, preferences, relevant Bible entries, earlier/recent passages, custom sources and operation instructions. Pin/exclude optional entries and set a source budget (estimated characters/4). Omitted sources are shown; required/pinned entries that cannot fit block generation. Input and system/operation instructions add to this estimated source budget.

**check structured canon** checks explicit confirmed metadata. For example, `{"alive":false}` flags a limited set of action verbs following the character's name/aliases; `{"forbiddenPhrases":["magic restores the dead"]}` flags literal rule conflicts. Findings include source passages, uncertainty and suggested manual resolution. For broader injuries, knowledge, possessions, relationships, chronology and world-rule analysis, choose the **continuity** AI operation. Neither checker automatically changes prose or guarantees semantic correctness.

## Node inference proxy and background jobs

Direct browser inference works in Node mode too. To keep an API key on the server and avoid endpoint CORS restrictions, configure the server before starting it. PowerShell example:

```powershell
$env:XENON_ENDPOINT = 'http://127.0.0.1:8080/v1'
$env:XENON_API_KEY = 'your-key-if-needed'
node server.js
```

In generation settings, enable **Use Node server profile**, leave server profile ID as `default`, and enter the model. The browser endpoint/key fields are unnecessary for proxy requests. Save a named profile to retain that choice. For multiple server destinations, `XENON_PROFILES` accepts JSON such as `{"local":{"endpoint":"http://127.0.0.1:8080/v1"},"remote":{"endpoint":"https://provider.example/v1","apiKey":"..."}}`. Browser requests can select only configured IDs; they cannot choose an arbitrary proxy destination. Redirects are rejected. Upstream diagnostic bodies/headers are not relayed, and environment keys are never returned or logged.

Under **Background jobs**, start the current operation using a server profile. Jobs continue after the browser closes. Refresh the list to review output or cancel. They never write manuscripts automatically. Jobs preserve partial output and become interrupted after server restart; automatic resumption is not implemented.

The server binds to `127.0.0.1` by default, rejects cross-origin API requests and unexpected Host headers, validates requests and private file paths, limits request sizes and shuts down its own generation requests gracefully. For explicit remote access, set `HOST` to the intended interface IP and `XENON_AUTH_TOKEN` to at least 24 characters; authenticate with browser HTTP Basic (any username; token as password) or Bearer for API clients. Use a trusted HTTPS reverse proxy/encrypted tunnel. No unauthenticated remote inference proxy is provided.

## Terminal

The original command semantics remain. Up/Down browse history, Tab completes legacy commands/paths/options, Ctrl+L clears output, and the terminal can be collapsed. Creative controls inherit through global → folder → book → chapter → scene. Loading a container shows its descendant scenes read-only; saving edits its controls. Record IDs stay stable through moves. Recursive generation supports auto-naming, missing/stale filters, dry runs, saved generation settings, reasoning and usage/rate metrics.

```text
mkdir -p /stories/book/chapter
touch /stories/book/chapter/scene
load /stories/book/chapter/scene
save
ls -r /
generate --dry-run --missing /stories/book
generate -r --missing /stories/book
generate . "Resolve the rivalry during the storm"
tracker new revision-state /stories/book
color pink
neofetch --ascii cherenkov
help

xenon help
xenon rewrite --selection
xenon expand --selection
xenon describe --selection
xenon brainstorm "plot twist"
xenon critique /stories/book/chapter/scene
xenon draft "Draft the confrontation from this outline…"
xenon bible add character "Mara"
xenon bible list
xenon continuity /stories/book
xenon context show
xenon context rebuild
xenon export /stories/book
xenon jobs
xenon cancel <job-id>
```

New terminal writing commands use the same services and review panel as GUI writing actions. Legacy `generate` retains its immediate replace/save behavior, with recoverable prior revisions, cancellation and protection against edits made during the request. A partial failed/cancelled legacy stream is preserved in preview while restoring the original editor text. `rm`/`rmdir` retain recoverable records in trash; **restore deleted records** imports them alongside current work. See the [original Cherenkov command reference](docs/CHERENKOV.md) for aliases, flags, tracker and creative-control details.

## Portable projects, backups and migration

**Export data** saves `xenon-workspace.json`, schema v2: `records`, `config`, `trackers`, `bible`, `profiles`, context preferences/policy, revisions, scratchpad and trash. Normal config/profile API keys are omitted from exports. Manuscript text and custom metadata remain verbatim, so remove secrets typed into those fields yourself before sharing an export.

**Import data** accepts legacy Cherenkov schema v1 `user.json` and Xenon v2 exports. Validation happens before mutation; a backup is created before merging. Existing manuscripts remain; colliding folders get an `-import` suffix and imported IDs/references are remapped. Current settings win when importing into a nonempty workspace. **backup** creates a recoverable snapshot; **recover backups** lists download/import actions. Recovery merges alongside current records rather than overwriting them.

Old OPFS records are origin-specific. To move from the original Cherenkov localhost origin to Node mode or `file://`:

1. Open Cherenkov at its original origin and export `user.json` using its export control.
2. Open Xenon in the desired runtime/origin and import that file.
3. Check scene contents/hierarchy and export a Xenon backup before removing any original data.

When Xenon runs on the same browser origin as older Cherenkov, it reads the legacy immutable-ID `records/` files if no snapshot exists, backs them up and creates a v2 workspace. Original record files remain untouched. Once migrated, Xenon uses its snapshot; use exports/imports instead of alternating apps against that same OPFS data.

Conflicts/storage failures are visible and stop further durable writes until reload. Export local work before reloading after a conflict. Browser writes use Web Locks where available; use one tab if they are unavailable. Node uses atomic replacement and ETag conflicts. Backups/revisions are retained without automatic pruning; localStorage keeps one rolling backup. The Node request limit is 25 MB per workspace; browser quotas vary.

## Verification and scope

```sh
npm test
```

Tests use Node's built-in runner. Real-Chromium tests run automatically when Chrome is found or `CHROME_PATH` points to a Chromium executable; otherwise that test is explicitly skipped. No npm packages or model credentials are required. The suite covers legacy records/commands/recursive auto-naming, hierarchy/inheritance, storage/migration/backups/conflicts, Bible/context/prompts/revisions, SSE/JSON/reasoning/usage/cancellation/timeouts, proxy/security, raw HTML and Node UI, persistence, safe preview rendering and mobile overflow. Browser screenshots are written to ignored `test-results/`.

This initial implementation is a plain-text writing environment. It has no automatic chapter-to-scene splitting, collaborative editing, embeddings, rich text, line-level revision diff, semantic continuity guarantees or automatic interrupted-job resumption. Candidate previews are session-local until accepted/exported; background job results persist. Core legacy code remains in `main.js`, with new services modularized. Full implementation details and remaining work are in [Architecture and status](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE), preserving Copyright (c) 2026 Colin Cho. Bundled Jua and VT323 font licenses are included under `licenses/`. Inherited neofetch image provenance is undocumented and needs verification before a public release; see [asset attribution](docs/THIRD_PARTY.md). No release has been published.
