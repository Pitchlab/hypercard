# CLAUDE.md — hypercard

## Project Overview

**hypercard** — CLI tool that turns a folder of interconnected markdown files into a queryable knowledge graph with hybrid search (BM25 + semantic vectors). Companion tool for Claude Code.

Internal spec and planning notes live in `dev-docs/` (gitignored, local only).

## Stack

- **Runtime**: Node.js / TypeScript
- **Package manager**: pnpm
- **DB**: better-sqlite3 (WAL mode, FTS5)
- **Embeddings**: @huggingface/transformers (Xenova/all-MiniLM-L6-v2, 384 dims)
- **CLI**: commander.js
- **File watching**: chokidar
- **Testing**: vitest
- **Output format**: YAML (js-yaml)

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build (tsc)
pnpm test             # Run unit + integration tests (daemon lifecycle covered via CLI integration tests)
pnpm typecheck        # Type-check without emitting
```

## Architecture

- `src/cli/` — Thin CLI client. Sends commands to daemon over Unix socket.
- `src/daemon/` — Background process: SQLite, ONNX model, file watcher, socket server.
- `src/core/` — Pure logic: parsing, indexing, search, graph traversal, conversion, link maintenance, suggestions. (lint/rename planned, not yet built.)
- `src/util/` — Helpers: YAML output, path resolution, fuzzy matching.

## Key Design Rules

- **One daemon per project root** — each `.hypercard/` gets its own daemon, socket, PID
- **Model cache is global** — `~/.hypercard/models/`, shared across all projects
- **Markdown files are source of truth** — hypercard never rewrites prose/content. The only writes it makes are *link maintenance*: `link`/`unlink` add or remove `[[refs]]`, and `convert --write` normalizes frontmatter, resolves bare links, and fixes filenames. These never touch fenced code blocks.
- **Links are exact** — `[[type/card_id]]`, no fuzzy resolution
- **Lint + Rename (Phase 5) are NOT implemented yet** — spec'd only; don't reference them as working commands.
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
