# Xenon implementation and status

## Inspected baseline

Implementation base: Cherenkov local checkpoint `c4c804a`, on branch `codex/xenon`. That checkpoint includes the user's Node server, batch views, configuration imports/exports, generation snapshots, context slider, and terminal completion. The original reference README is preserved in `CHERENKOV.md`.

The complete baseline consists of `index.html`, `main.js`, `styles.css`, `server.js`, `package.json`, an empty `user.json`, MIT `LICENSE`, and two fonts. There were no existing tests or additional branches besides main. The existing client is one classic script, with independent parsed-command handlers and shared record/editor state. Its inline photo samples support the three neofetch variants.

Legacy OPFS data uses `records/<immutable-id>.json`. Virtual paths are fixed at `/folder/book/chapter/scene`; moves change metadata and descendants, preserving IDs. Controls inherit from global → folder → book → chapter → scene. Named trackers hold per-record text. The existing generation system handles missing/stale/forced/recursive queues, auto-naming, streaming, reasoning, request snapshots, and rate measurements. Terminal aliases, flags, themes, completion/history, batch views, and the neofetch renderer remain in `main.js`.

## Shared services

| File | Responsibility |
| --- | --- |
| `core/xenon.js` | Portable schema v2, validation/migration, hierarchy/inheritance, revisions, guarded acceptance, Bible schema, deterministic retrieval, structured continuity, operation prompts |
| `ai/providers.js` | Capability-aware chat requests, SSE/JSON parsing, reasoning, usage/speed, timeouts, cancellation, bounded retries |
| `adapters/browser-storage.js` | Runtime detection, OPFS/localStorage/memory fallbacks, safe settings, legacy record migration, snapshot persistence, backup/recovery, optimistic conflicts, Web Locks when available |
| `adapters/node-storage.js` | Serialized native filesystem commits, version checks, atomic replacement, recoverable backups |
| `core/jobs.js` | Persistent Node job status/output, checkpoints, cancellation, interrupted-job recovery |
| `main.js` | Preserved Cherenkov editor, controls, hierarchy commands, trackers, themes and terminal; delegates storage and networking |
| `xenon-app.js` | UI integration, scratchpad/autosave, undo/redo, import merging, writing preview workflow, Bible/context/revision UI, shared terminal services |
| `server.js` | Loopback HTTP server, restricted static assets, validated APIs, configured inference destinations, authentication, jobs and shutdown |

Classic scripts avoid ES-module restrictions when opened through `file://`. The pure services use a small CommonJS/browser wrapper so tests and the server use the same logic. Existing terminal handlers remain together to reduce compatibility risk; this is an incremental refactor rather than a complete decomposition of the inherited script.

## Integrity rules

- Imports are fully validated before changes; current work is saved and backed up first. Imports merge alongside existing records. Any colliding imported folder is renamed with `-import`, and colliding IDs are regenerated. Imported Bible scope/source links are remapped. Existing configuration wins unless the current workspace is empty.
- Revisions preserve prior saved text. Deleted records remain in portable `trash`. Deleted records can be restored through the UI; conflicts create an imported sibling rather than replacing current work.
- Preview acceptance checks stable ID, version, full source content and editor epoch. A change during generation leaves the candidate reviewable and the manuscript untouched.
- Original `generate` commands preserve their immediate generation semantics, with revisions and change safeguards. Each scene is persisted before continuing. Cancelling a partial stream restores the original text and retains partial output in preview.
- The original recursive auto-name loop could overwrite later generated scenes with stale records after a refresh. Each iteration now reacquires its queued scene by immutable ID; browser regression tests exercise two generated/renamed scenes in both modes.
- Node snapshots use serialized writes, `If-Match` optimistic concurrency, pre-write backups, fsync and rename. Run one server process per data directory. External file editing/concurrent independent server processes are unsupported.
- Browser snapshots use storage versions and Web Locks when supported. Without Web Locks, simultaneous writes from separate tabs are not guaranteed atomic; use one tab. Quota/storage failures produce a persistent warning and stop subsequent writes until reload, preserving the local editor for export.
- OPFS migrations preserve original record files and create a pre-migration snapshot. After migration, the v2 snapshot is authoritative. Do not alternate Cherenkov and Xenon against the same OPFS origin; use export/import between applications.

## Implemented and bounded features

All seven core writing operations are functional: Continue, Rewrite, Expand, Describe, Brainstorm, Critique and Draft. Extraction and LLM continuity analysis use the same engine. They support explicit input, inherited controls, relevant context, operation-specific model overrides, sequential multiple candidates, streaming previews, cancellation, copy/export, reject/regenerate and conflict-safe acceptance. Analysis/brainstorm output is copied/exported rather than directly replacing prose. Continue accepts as an append; Rewrite/Expand/Describe/Draft replace the captured selection or full scene. Appending is also explicit.

Story Bible supports all requested kinds, stable IDs, aliases, descriptions, references, JSON metadata and canon/draft/speculation/outdated/contradicted status. Extraction creates individual review candidates; accepting saves them as drafts. A human can then edit/promote canon. Each book has its own entries; imported global `/` entries also apply.

The context engine ranks Bible canon/relevance and earlier/recent scene passages deterministically. Inherited controls, ancestor premises/instructions, global preferences, custom sources and operation instructions are included. It has a configurable estimated source-token budget, pin/exclude controls and an inspector of the generated messages. Required/pinned entries that cannot fit block generation. Other omissions are displayed. No embeddings or vector database are used.

Structured continuity is deliberately narrow: confirmed metadata `alive:false` checks a few explicit action verbs; `forbiddenPhrases:[...]` checks literal rules. Optional `after` is a lexically ordered scene path boundary. Each result includes passages, uncertainty and a suggested manual resolution. The LLM operation covers injuries, deaths, locations, possessions, relationships, chronology, world rules, knowledge and events, but its findings are suggestions. Neither checker rewrites manuscripts.

Undo/redo works per loaded scene for input and accepted changes. Saved draft history persists; its comparison shows previous/current text side by side, not a line-level diff. Search/replace supports literal scene text, and project search returns matching scenes. Previous/next navigation follows the selected book's scene ordering. Scratchpad text persists separately when no scene is loaded.

Node background jobs persist server-side, checkpoint partial output every two seconds, survive page closure, and become `interrupted` after a server restart. They never change manuscripts automatically. The Jobs UI refreshes explicitly and lets users review output in the current scene's preview. Requests/keys are not persisted in job history, so jobs are not automatically resumed after restart.

## Known limitations and remaining work

- No live model credentials were available; generation was verified against deterministic local mock inference servers, including the real browser and proxy.
- Raw file persistence and cross-origin inference depend on the browser/provider. Chrome on this machine passed; other browsers are not certified. Private modes may provide temporary storage. Export remains essential.
- This is a plain-text scene editor. Rich text, collaborative editing, tracked changes, structured automatic chapter splitting, semantic continuity guarantees, embeddings and automatic job resumption are not implemented.
- Draft can generate chapter-length prose into a selected target scene, with iterative review. Creating/reviewing a structured chapter scene-by-scene uses existing scene hierarchy/commands; there is no outline-to-many-scenes review queue.
- Candidate previews are session-local until accepted/exported; closing with a candidate prompts a warning. Node jobs persist separately. Extracted draft candidates require acceptance to persist.
- Global instructions and custom sources can be large. The inspector budget estimates context characters/4 and does not promise the model's exact tokenizer/window size. The input and operation/system instructions add to the source budget; configure provider limits accordingly.
- Backups and revisions are retained without automatic pruning. Review/export/archive data periodically; the Node HTTP workspace limit is 25 MB. Browser localStorage has a much smaller browser-dependent quota and retains one rolling backup.
- Browser credentials are accessible to the browser profile and local workspace storage. Exports omit normal config/profile API keys; secrets typed into manuscript/metadata remain manuscript content. Node environment keys never enter frontend settings.
- Remote binding requires explicit HOST and strong authentication; place it behind a trusted HTTPS reverse proxy or encrypted tunnel. A dedicated reverse-proxy deployment mode and user/role management are not included.
- The legacy script remains large, though new pure services are separated and independently tested. Further extraction should preserve the compatibility suite.
- The inherited neofetch image provenance is unresolved; see `THIRD_PARTY.md`. This work did not publish a release or push the Xenon implementation branch.

## File inventory and verification

Modified: `README.md`, `index.html`, `styles.css`, `main.js`, `server.js`, `package.json`.

Created: `.gitignore`, `core/xenon.js`, `core/jobs.js`, `ai/providers.js`, `adapters/browser-storage.js`, `adapters/node-storage.js`, `xenon-app.js`, `tests/fixtures.js`, `tests/core.test.js`, `tests/browser-storage.test.js`, `tests/server.test.js`, `tests/browser.test.js`, `docs/CHERENKOV.md`, `docs/ARCHITECTURE.md`, `docs/THIRD_PARTY.md`, `licenses/jua-OFL.txt`, `licenses/vt323-OFL.txt`.

`LICENSE`, both bundled font binaries, and the original `user.json` remain unchanged. The baseline local changes were committed and pushed first as `c4c804a`; Xenon work is isolated on `codex/xenon`.

On November 5, 2026, `npm test` passed all 24 tests with no skips, using Node v25.5.0 and locally installed headless Chrome. Tests include actual `file://` loading and Node HTTP/browser operation, real mock-provider streaming/proxying, recursive generation/naming, cancellation with original-text restoration, JSON import collisions/preferences/scratch preservation, reload persistence, mobile overflow and screenshots. Node HTTP tests cover auth, origin/Host rejection, private/static path restrictions, request validation/size limits, destination restrictions, redirection rejection, backups/ETags, jobs/cancellation/restart status and key non-disclosure. `git diff --check` passed. No real-provider credentials were used.
