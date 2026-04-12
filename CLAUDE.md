# CLAUDE.md — hypercard

## Project Overview

**hypercard** — CLI tool that turns a folder of interconnected markdown files into a queryable knowledge graph with hybrid search (BM25 + semantic vectors). Companion tool for Claude Code.

Spec: `docs/hypercard-prd.md`

## Stack

- **Runtime**: Node.js / TypeScript
- **Package manager**: pnpm
- **DB**: better-sqlite3 (WAL mode, FTS5)
- **Embeddings**: @xenova/transformers (all-MiniLM-L6-v2, 384 dims)
- **CLI**: commander.js
- **File watching**: chokidar
- **Testing**: vitest
- **Output format**: YAML (js-yaml)

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build (tsc)
pnpm test             # Run unit + integration tests
pnpm test:e2e         # Run e2e tests (daemon lifecycle, multi-project)
pnpm lint             # Lint
```

## Architecture

- `src/cli/` — Thin CLI client. Sends commands to daemon over Unix socket.
- `src/daemon/` — Background process: SQLite, ONNX model, file watcher, socket server.
- `src/core/` — Pure logic: parsing, indexing, search, graph traversal, lint, rename.
- `src/util/` — Helpers: YAML output, path resolution, fuzzy matching.

## Key Design Rules

- **One daemon per project root** — each `.hypercard/` gets its own daemon, socket, PID
- **Model cache is global** — `~/.hypercard/models/`, shared across all projects
- **Markdown files are source of truth** — hypercard is read/query/validate only, never writes content
- **Links are exact** — `[[type/card_id]]`, no fuzzy resolution
- **ID = relative path minus .md** — `factions/crimson_order.md` → `factions/crimson_order`
- **Type = first path segment** — `factions/northern/x.md` → type `factions`
- **CLI output is YAML to stdout**, errors to stderr

## Conventions

- Interface naming: `ICard`, `IEdge`, `ISearchResult` (I-prefix)
- Class naming: `CardParser`, `SearchEngine` (no prefix)
- No legacy patterns
- Always update CHANGELOG.md before committing
- Only commit when explicitly asked

## Implementation Phases

1. Core Index + Get + Ls (no daemon, direct SQLite)
2. BM25 Search + Graph Traversal
3. Daemon + File Watcher
4. Semantic Search (Embeddings)
5. Lint + Rename
6. Polish
