# Changelog

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
