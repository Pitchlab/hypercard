# HyperCard CLI

A CLI tool that turns a folder of interconnected markdown files into a queryable knowledge graph with hybrid search (BM25 + semantic vectors).

**Primary consumers**: Claude Code (via bash), humans (via terminal).

## Install

```bash
# From the repo root:
pnpm install && pnpm build
npm link    # Makes 'hypercard' available globally

# Then from any project folder:
hypercard init
```

## Quick Start

```bash
# Initialize in a folder containing .md files
hypercard init

# List all indexed cards
hypercard ls

# Get a specific card with its links
hypercard get factions/rebels

# Get by fuzzy shorthand
hypercard get rebels
```

## Card Format

Every `.md` file under the project root is a **card**.

```markdown
---
tags: [military, antagonist]
status: published
era: medieval
---

# The Crimson Order

A militaristic faction controlling [[locations/iron_citadel]].
Founded by [[characters/voss|Commander Voss]] during [[events/the_shattering]].
```

**Rules**:
- **ID** = filepath relative to project root, minus `.md` extension → `factions/crimson_order`
- **Type** = first directory segment → `factions`
- **Title** = first `# Heading` in the file (falls back to filename)
- **Tags** = `tags` array in YAML frontmatter
- **Links** = `[[exact/card_id]]` or `[[exact/card_id|Display Text]]` — must be exact IDs
- **Frontmatter** = All frontmatter keys are queryable with `hypercard ls --where key=value`

## Commands

### `hypercard init`

Initialize a new HyperCard project. Creates `.hypercard/` directory with config and SQLite database. Indexes all `.md` files.

```bash
hypercard init
```

Output:
```yaml
initialized: true
root: /home/user/worldbuilding
cards: 47
types: [factions, characters, locations, events]
links: 183
broken_links: 2
```

### `hypercard ls`

List all cards with link counts.

```bash
hypercard ls                       # All cards
hypercard ls --type=factions       # Filter by type
hypercard ls --tag=military        # Filter by tag
hypercard ls --orphans             # Cards with zero links
hypercard ls --where status=draft          # Filter by frontmatter field
hypercard ls --where status=draft --where era=medieval  # Multiple filters (AND)
hypercard ls --search "crimson"            # Full-text search in list
hypercard ls --search "warrior" --type=factions         # Search + type filter
hypercard ls --type=factions --tag=military --where status=published  # All filters combined
```

Output:
```yaml
count: 47
cards:
  - id: factions/crimson_order
    title: The Crimson Order
    type: factions
    tags: [military, antagonist]
    links_out: 6
    links_in: 4
```

### `hypercard get <id>`

Fetch a single card by exact ID or fuzzy shorthand.

```bash
hypercard get factions/crimson_order   # Exact
hypercard get crimson_order            # Fuzzy shorthand
hypercard get voss                     # Resolves if unambiguous
```

Output:
```yaml
card:
  id: factions/crimson_order
  path: factions/crimson_order.md
  title: The Crimson Order
  type: factions
  tags: [military, antagonist]
  content: |
    ...full markdown content...
  links_out:
    - locations/iron_citadel
    - characters/voss
  links_in:
    - characters/voss
    - events/the_shattering
```

Ambiguous shorthand returns candidates:
```yaml
error: ambiguous_id
query: voss
candidates:
  - characters/voss
  - characters/voss_jr
```

### `hypercard convert [file]`

Convert existing markdown files to HyperCard format. Ensures frontmatter exists with `tags`, resolves bare wiki-links like `[[rebels]]` to full paths like `[[factions/rebels]]`, and flags filename issues. Dry-run by default.

```bash
hypercard convert notes.md              # Dry-run single file
hypercard convert notes.md --write      # Apply changes
hypercard convert --all                 # Dry-run all .md files
hypercard convert --all --write         # Apply to all files
```

Output:
```yaml
dry_run: true
files_processed: 3
files_modified: 2
files_renamed: 0
changes:
  - file: factions/crimson order.md
    frontmatter_added: true
    links_fixed: 2
    link_changes:
      - from: "[[rebels]]"
        to: "[[factions/rebels]]"
    filename_issues:
      - issue: spaces_in_filename
        suggestion: factions/crimson_order.md
warnings:
  - file: notes.md
    message: "File in project root (no type directory)"
```

With `--write`:
- Adds frontmatter/tags to files
- Resolves bare wiki-links to full paths
- Renames files (spaces → underscores, uppercase → lowercase)
- Updates `[[references]]` in other files after rename

### `hypercard index`

Reindex the database.

```bash
hypercard index                        # Full reindex
hypercard index --only factions/x.md   # Single file
hypercard index --check                # Dry run: show stale without writing
```

### `hypercard search <query>` (Phase 2+)

Hybrid search across all cards.

```bash
hypercard search "crimson military"
hypercard search "crimson" --type=factions
hypercard search "trade" --tag=neutral
hypercard search "crimson" --bm25       # Keyword only
hypercard search "warriors" --semantic  # Semantic only
hypercard search "crimson" --limit=20
```

### `hypercard graph <id>` (Phase 2+)

Fetch a card and its connected neighborhood.

```bash
hypercard graph factions/crimson_order
hypercard graph factions/crimson_order --depth=2 --max=20
hypercard graph factions/crimson_order --exclude=events
hypercard graph factions/crimson_order --out   # Outgoing only
hypercard graph factions/crimson_order --in    # Backlinks only
```

### `hypercard lint` (Phase 5+)

Check integrity of the knowledge graph.

```bash
hypercard lint           # Find broken links, orphans, duplicates
hypercard lint --fix     # Auto-remove dead edge rows
```

### `hypercard rename <old> <new>` (Phase 5+)

Rename a card and update all cross-file references.

```bash
hypercard rename factions/old_name factions/new_name
```

## Architecture

- `.hypercard/hypercard.db` — SQLite database (WAL mode, FTS5 full-text search)
- `.hypercard/config.yaml` — Project configuration
- One daemon per project root (auto-starts, auto-exits after 30min idle)
- Model cache at `~/.hypercard/models/` (shared across projects)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev          # Watch mode
```

---

## Claude Code Integration

> **Copy the section below into your `CLAUDE.md`, `skill.md`, or `agent.md` to teach Claude how to use HyperCard.**

---

### HyperCard — AI Agent Reference

HyperCard is a CLI that indexes `.md` files into a searchable knowledge graph. You query it via bash. You edit `.md` files directly with your normal tools.

**Card format**: `.md` files with optional `tags: [...]` frontmatter and `[[type/card_id]]` wiki-links. Card ID = filepath minus `.md`. Type = first directory segment.

**All output is YAML to stdout.**

#### Commands

```
hypercard init                              # Initialize project, index all .md files
hypercard ls                                # List all cards (id, title, type, tags, link counts)
hypercard ls --type=<type>                  # Filter by type
hypercard ls --tag=<tag>                    # Filter by tag
hypercard ls --orphans                      # Cards with no links in or out
hypercard ls --where <key>=<value>          # Filter by any frontmatter field (repeatable)
hypercard ls --search "<query>"             # Full-text search within card list
hypercard get <id>                          # Get card by exact ID (content + links_out + links_in)
hypercard get <shorthand>                   # Fuzzy resolve (errors if ambiguous with candidates)
hypercard convert <file>                    # Dry-run: check frontmatter, links, filenames
hypercard convert <file> --write            # Apply conversions
hypercard convert --all                     # Dry-run all .md files
hypercard convert --all --write             # Apply to all files
hypercard index                             # Full reindex
hypercard index --only <file>               # Reindex single file
hypercard index --check                     # Show stale/missing/new without writing
hypercard search "<query>"                  # Hybrid search (BM25 + semantic)
hypercard search "<query>" --type=<t>       # Filter search by type
hypercard search "<query>" --tag=<t>        # Filter search by tag
hypercard search "<query>" --limit=<n>      # Max results (default: 10)
hypercard search "<query>" --bm25           # Keyword search only
hypercard search "<query>" --semantic       # Semantic search only
hypercard graph <id>                        # Get card + connected neighborhood
hypercard graph <id> --depth=<n>            # Hops to follow (default: 1, max: 3)
hypercard graph <id> --max=<n>              # Max included cards (default: 20, max: 50)
hypercard graph <id> --out                  # Outgoing links only
hypercard graph <id> --in                   # Incoming links only (backlinks)
hypercard graph <id> --exclude=<types>      # Exclude types (comma-separated)
hypercard graph <id> --include=<t:detail>   # Type with detail level (full|summary|meta|id)
hypercard lint                              # Check broken links, orphans, duplicates
hypercard lint --fix                        # Remove dead edge rows
hypercard rename <old_id> <new_id>          # Rename card + update all [[refs]]
hypercard status                            # Daemon + index status
hypercard notify <file>                     # Fire-and-forget reindex trigger (for hooks)
hypercard stop                              # Stop background daemon
```

#### When to use

- "What do we know about X?" → `hypercard search "X"` then `hypercard get <id>`
- "How is X connected to Y?" → `hypercard graph <id> --depth=2`
- "Find related content" → `hypercard search` + `hypercard graph`
- "Check consistency" → `hypercard lint`
- "Rename/reorganize" → `hypercard rename`
- Adding/editing knowledge → edit the `.md` file directly, then `hypercard lint`

#### Rules

- Links must be exact IDs: `[[factions/crimson_order]]` not `[[crimson_order]]`
- Always verify IDs exist with `hypercard ls` or `hypercard search` before adding `[[links]]`
- After bulk edits, run `hypercard lint` to check for broken links
- The `.md` files are the source of truth — HyperCard is a read/query layer
- Never invent card IDs — always search first
