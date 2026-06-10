# Changelog

## [Unreleased] - 2026-06-10

### Added
- **Temporal layer — time as a scalar filter over cards.** Each card carries a canonical `timestamp` (epoch ms), pre-computed at index time from a frontmatter date field (`date`/`created`/`created_at`/`published`/`timestamp`/`updated`/`modified`/…, in priority order) with a fallback to file mtime (`src/util/dates.ts`). New SQLite `timestamp` column + index, with an automatic migration (backfilled from mtime) for existing databases. Time is a scalar, so it's a plain inclusive range — no embeddings, no proximity ranking, no cyclic encoding (YAGNI).
  - **`ls` and `search` gain `--after` / `--before`.** Filter by card timestamp; a bare `--before 2025-06-10` is inclusive of the whole day. Combine with all other filters via AND.
- **`search` interface overhaul.** Retrieval mode is now a single `--mode <bm25|semantic|hybrid>` (default `hybrid`) instead of three boolean flags. `--limit` renamed to `--topk`. New `--format <list|summary|full>` (default `summary`): `list` is a compact one-liner per hit (`id`, `title`, `timestamp`, `tags`, `score`), `full` adds the card's content. New `--traverse <depth>` (1–3) nests each hit's link neighborhood as compact nodes under `links_out`/`links_in` (neighbors carry no snippet/score and are budget-capped at 50 to bound deep traversals).
  - Decided against the heavier `hypergraph-temporal-layer` vision (time as a learned vector embedding / multiplex graph embeddings): for range + filtering a numeric column beats a vector on every axis (exact, cheap, interpretable). See the idea note for the rationale.

### Fixed
- **Code-block-aware link extraction.** `[[refs]]` inside fenced (```` ``` ````/`~~~`) or inline code are no longer indexed as edges, rewritten by `convert`, or matched by `link`/`unlink`. New `src/util/markdown.ts` (`stripCodeRegions`, `structuralLineFlags`) preserves character offsets so context/positions stay correct.
- **`convert --write` data-safety.** A filename with BOTH spaces and uppercase now renames in a single canonical pass (was: a second `renameSync` crashing with ENOENT, leaving the tree half-renamed). Added a collision guard that refuses to overwrite a different existing file (critical on case-insensitive macOS). Frontmatter is no longer round-tripped through the YAML dumper when only adding `tags: []` — key order and quoting are preserved. Cross-file reference updates read-once/write-once and follow files renamed earlier in the same run.
- **`unlink` no longer corrupts Markdown.** Whitespace is tidied only on lines that actually contained the removed link, preserving hard line breaks (trailing double space) and table padding elsewhere. `link` never inserts into frontmatter or code blocks.
- **Daemon concurrency.** Added an exclusive startup lock so parallel CLI invocations can't both launch a daemon and delete each other's socket. Auto-reindex and the file watcher now share a serial queue, preventing overlapping SQLite transactions ("cannot start a transaction within a transaction"). Added `uncaughtException`/`unhandledRejection` handlers that clean up PID/socket/lock on crash. The daemon's command wrapper now forwards `onProgress` (index progress was silently dropped). Daemon stdout/stderr is captured to `.hypercard/daemon.log` so startup failures are diagnosable instead of lost.
- **Indexer** no longer rebuilds every edge row on each full reindex — edges are rebuilt only when a card's content hash changed (mtime is still refreshed).
- **Socket permissions** set via a restrictive umask around `listen()`, closing the brief world-accessible window before `chmod 0600`.

### Changed
- **Docs accuracy.** Marked `lint`/`rename` as planned-not-implemented across README and CLAUDE.md; documented the shipped `link`/`unlink`/`suggest-links`/`start` commands; corrected the search default (hybrid, not BM25); fixed the embeddings package name (`@huggingface/transformers ^3.8.1`, not `@xenova/transformers`); clarified that link maintenance is the one exception to "never writes content".
- **Tooling**: removed the broken `test:e2e` script (no config/tests existed; daemon lifecycle is covered by the CLI integration suite). `.gitignore` now ignores `.hypercard/` and `dev-docs/` (was a stale `.maas/`).
- **Tests**: +61 new tests (275 total) covering code-block stripping, linker insert/remove safety, the canonical rename + collision guard, the serial queue + startup lock, and the temporal layer + search overhaul (timestamp derivation, date-boundary parsing, range filters, `--format` shaping, and `--traverse` compact-neighborhood building).

### Removed
- Internal planning docs (`docs/`) moved to local-only `dev-docs/` (gitignored) and purged from git history.

## [0.3.0-dev] - 2026-04-12

### Fixed
- **Malformed frontmatter no longer crashes the indexer.** Files with broken YAML frontmatter are now skipped with a clear warning (`WARNING: frontmatter in file <path> is malformed — skipping`). Previously one bad file would abort the entire index run.
- **Indexer now respects `.hypercard/config.yaml` `watch.exclude`** patterns. Previously the ignore list was hardcoded in `indexer.ts` and any user config was silently ignored.
- **Nested `node_modules/` directories are now excluded.** The default pattern was `node_modules/**` which only matched top-level directories, so nested installs like `frontend/node_modules/` leaked thousands of irrelevant markdown files into the index. Changed to `**/node_modules/**`. Legacy `node_modules/**` entries in existing configs are auto-normalized at runtime.
- **Integration test teardown** — added retry loop around `fs.rmSync` to handle ENOTEMPTY when the daemon is still releasing file handles. Resolves flaky `search-cli` / `cli` / `graph-cli` test failures.

### Changed
- **Repo**: Extracted to its own standalone repository from the `pitchlab-tools` monorepo. Git history preserved via subtree split.
- **Tests**: Integration test `CLI_PATH` now resolves via `process.cwd()` instead of a hardcoded absolute path.
- **Package**: Added `repository`, `homepage`, `bugs`, `keywords`, `author`, and `files` fields to `package.json`. Version bumped to `0.3.0` to match implementation.
- **License**: Added `LICENSE` file (MIT).

### Known issues
- `tests/indexer.test.ts > checkStaleness() > detects multiple types of staleness simultaneously` is flaky due to mtime precision on fast filesystems. Passes in isolation, occasionally fails in full-suite runs. Not a regression from the extraction.

## [0.3.0] - 2026-02-24

### Added
- **CLI**: `maas graph <id>` — BFS graph traversal of card neighborhoods
  - `--depth` (1-3), `--max` (1-50) for traversal control
  - `--out` / `--in` for directional filtering
  - `--exclude` to skip card types
  - `--include` for per-type detail levels (full/summary/meta/id)
  - Root card always at full detail, neighbors at configurable detail
  - Cycle avoidance, broken link detection, truncation reporting
- **Core**: `graph.ts` — pure BFS traversal logic with detail levels and direction control
- 28 new tests (212 total passing)
- Phase 2 (BM25 Search + Graph Traversal) is now complete

## [0.2.0] - 2026-02-23

### Added
- **CLI**: `maas convert [file]` — convert markdown files to Maas format (frontmatter, link resolution, filename fixes)
  - `--all` flag to process all .md files
  - `--write` flag to apply changes (dry-run by default)
  - Resolves bare wiki-links `[[rebels]]` to full paths `[[factions/rebels]]`
  - Detects filename issues (spaces, uppercase, no type directory)
  - Renames files and updates cross-references with `--write`
- **CLI**: `maas search <query>` — BM25 full-text search with scored results and snippets
  - `--type`, `--tag`, `--where` filters
  - `--limit` for result count (default 10)
  - `--bm25` flag (default), `--semantic` and `--hybrid` stubs for Phase 4
  - Normalized scores (0-1) and context-aware snippet generation
- **CLI**: `maas ls --where key=value` — filter cards by frontmatter fields (repeatable, AND logic)
- **CLI**: `maas ls --search "query"` — full-text search within card listing
- **Core**: `searchCardsWithScores()` — BM25 search returning ISearchResult with scores and snippets
- **Core**: `converter.ts` — pure conversion logic for frontmatter, link resolution, filename checks
- **Docs**: `docs/plan.md` — implementation plan for Phases 2-6
- 75 new tests (184 total passing)

## [0.1.0] - 2026-02-23

### Added
- Initial Phase 1 implementation of Maas CLI
- **Core**: Markdown parser with frontmatter extraction (gray-matter) and [[wiki-link]] parsing
- **Core**: SQLite database layer with FTS5 full-text search, WAL mode, edge tracking
- **Core**: Filesystem indexer with staleness detection (mtime comparison)
- **CLI**: `maas init` — initialize project, create .maas/, index all .md files
- **CLI**: `maas ls` — list cards with --type, --tag, --orphans filters
- **CLI**: `maas get <id>` — fetch card by exact or fuzzy shorthand ID
- **CLI**: `maas index` — full reindex, --only single file, --check dry run
- **Utils**: Fuzzy ID matching for shorthand card lookups
- **Utils**: YAML output formatting for all commands
- **Utils**: Project root detection (walk up to find .maas/)
- Machine-readable help text for all commands
- README with Claude Code integration section (copy-paste into CLAUDE.md/skill.md)
- 109 passing tests (unit + integration)
- Product specification (docs/maas-prd.md) with multi-project daemon support
- Full implementation plan for Phases 1-6 (docs/implementation-plan.md)
