# Changelog

## [0.3.0] - 2026-02-24

### Added
- **CLI**: `hypercard graph <id>` — BFS graph traversal of card neighborhoods
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
- **CLI**: `hypercard convert [file]` — convert markdown files to HyperCard format (frontmatter, link resolution, filename fixes)
  - `--all` flag to process all .md files
  - `--write` flag to apply changes (dry-run by default)
  - Resolves bare wiki-links `[[rebels]]` to full paths `[[factions/rebels]]`
  - Detects filename issues (spaces, uppercase, no type directory)
  - Renames files and updates cross-references with `--write`
- **CLI**: `hypercard search <query>` — BM25 full-text search with scored results and snippets
  - `--type`, `--tag`, `--where` filters
  - `--limit` for result count (default 10)
  - `--bm25` flag (default), `--semantic` and `--hybrid` stubs for Phase 4
  - Normalized scores (0-1) and context-aware snippet generation
- **CLI**: `hypercard ls --where key=value` — filter cards by frontmatter fields (repeatable, AND logic)
- **CLI**: `hypercard ls --search "query"` — full-text search within card listing
- **Core**: `searchCardsWithScores()` — BM25 search returning ISearchResult with scores and snippets
- **Core**: `converter.ts` — pure conversion logic for frontmatter, link resolution, filename checks
- **Docs**: `docs/plan.md` — implementation plan for Phases 2-6
- 75 new tests (184 total passing)

## [0.1.0] - 2026-02-23

### Added
- Initial Phase 1 implementation of HyperCard CLI
- **Core**: Markdown parser with frontmatter extraction (gray-matter) and [[wiki-link]] parsing
- **Core**: SQLite database layer with FTS5 full-text search, WAL mode, edge tracking
- **Core**: Filesystem indexer with staleness detection (mtime comparison)
- **CLI**: `hypercard init` — initialize project, create .hypercard/, index all .md files
- **CLI**: `hypercard ls` — list cards with --type, --tag, --orphans filters
- **CLI**: `hypercard get <id>` — fetch card by exact or fuzzy shorthand ID
- **CLI**: `hypercard index` — full reindex, --only single file, --check dry run
- **Utils**: Fuzzy ID matching for shorthand card lookups
- **Utils**: YAML output formatting for all commands
- **Utils**: Project root detection (walk up to find .hypercard/)
- Machine-readable help text for all commands
- README with Claude Code integration section (copy-paste into CLAUDE.md/skill.md)
- 109 passing tests (unit + integration)
- Product specification (docs/hypercard-prd.md) with multi-project daemon support
- Full implementation plan for Phases 1-6 (docs/implementation-plan.md)
