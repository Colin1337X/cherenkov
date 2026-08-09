# Cherenkov

Cherenkov is a dependency-free, browser-based story generator controlled through a small shell. The application remains four runtime files: `index.html`, `styles.css`, `main.js`, and `Jua-Regular.ttf`. This README is documentation only.

Serve the directory over localhost so the browser can use Origin Private File System (OPFS):

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Commands

```text
mkdir /folder
mkdir /folder/book
mkdir /folder/book/chapter
touch /folder/book/chapter/scene
load /folder/book/chapter/scene
save
ls /
pwd
cd /folder/book
mv /folder/book/chapter/scene /folder/book/chapter/new-name
rm /folder/book/chapter/new-name
generate /folder/book
generate --missing /folder/book
clear
help
```

Paths use the fixed hierarchy `/folder/book/chapter/scene`. OPFS stores each record as `/records/<immutable-id>.json`; moving a story node changes its virtual `path` and its descendants, not its storage filename.

## Architecture change

```mermaid
flowchart LR
    subgraph Before[Existing prototype]
        direction TB
        BUI[Terminal input] --> BPARSE[String mutated as parsed command]
        BPARSE --> BDISPATCH[Handlers nested under generate]
        BDISPATCH --> BSTATE[Temporary pwd]
        BDISPATCH --> BFILES[Physical file moves]
        BDISPATCH --> BAPI[Malformed messages payload]
    end

    subgraph After[Current architecture]
        direction TB
        AUI[Terminal input] --> APARSE[Parsed command object]
        APARSE --> ACMD[Independent command handlers]
        ACMD --> APATH[Persistent virtual path]
        APATH --> ARECORDS[Canonical story records]
        ARECORDS <--> AOPFS[OPFS records by immutable ID]
        ARECORDS --> ACTX[Inherited scene context]
        ACTX --> AAPI[System and user messages]
        AAPI --> ARECORDS
    end
```

The terminal changes navigation and records, the editor changes the loaded scene, the explorer reflects stored virtual paths, and the configuration panel supplies the OpenAI-compatible endpoint, key, model, and system prompt.
