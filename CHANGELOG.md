# Changelog

## [Unreleased] - 2026-04-12

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
