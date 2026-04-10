# Maas CLI

A CLI tool that turns a folder of interconnected markdown files into a queryable knowledge graph with hybrid search (BM25 + semantic vectors).

**Primary consumers**: Claude Code (via bash), humans (via terminal).

## Install

```bash
# From the repo root:
pnpm install && pnpm build
npm link    # Makes 'maas' available globally

# Then from any project folder:
maas init
```

## Quick Start

```bash
# Initialize in a folder containing .md files
maas init

# List all indexed cards
maas ls

# Get a specific card with its links
maas get factions/rebels

# Get by fuzzy shorthand
maas get rebels
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
- **Frontmatter** = All frontmatter keys are queryable with `maas ls --where key=value`

## Commands

### `maas init`

Initialize a new Maas project. Creates `.maas/` directory with config and SQLite database. Indexes all `.md` files.

```bash
maas init
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

### `maas ls`

List all cards with link counts.

```bash
maas ls                       # All cards
maas ls --type=factions       # Filter by type
maas ls --tag=military        # Filter by tag
maas ls --orphans             # Cards with zero links
maas ls --where status=draft          # Filter by frontmatter field
maas ls --where status=draft --where era=medieval  # Multiple filters (AND)
maas ls --search "crimson"            # Full-text search in list
maas ls --search "warrior" --type=factions         # Search + type filter
maas ls --type=factions --tag=military --where status=published  # All filters combined
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

### `maas get <id>`

Fetch a single card by exact ID or fuzzy shorthand.

```bash
maas get factions/crimson_order   # Exact
maas get crimson_order            # Fuzzy shorthand
maas get voss                     # Resolves if unambiguous
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

### `maas convert [file]`

Convert existing markdown files to Maas format. Ensures frontmatter exists with `tags`, resolves bare wiki-links like `[[rebels]]` to full paths like `[[factions/rebels]]`, and flags filename issues. Dry-run by default.

```bash
maas convert notes.md              # Dry-run single file
maas convert notes.md --write      # Apply changes
maas convert --all                 # Dry-run all .md files
maas convert --all --write         # Apply to all files
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

### `maas index`

Reindex the database.

```bash
maas index                        # Full reindex
maas index --only factions/x.md   # Single file
maas index --check                # Dry run: show stale without writing
```

### `maas search <query>` (Phase 2+)

Hybrid search across all cards.

```bash
maas search "crimson military"
maas search "crimson" --type=factions
maas search "trade" --tag=neutral
maas search "crimson" --bm25       # Keyword only
maas search "warriors" --semantic  # Semantic only
maas search "crimson" --limit=20
```

### `maas graph <id>` (Phase 2+)

Fetch a card and its connected neighborhood.

```bash
maas graph factions/crimson_order
maas graph factions/crimson_order --depth=2 --max=20
maas graph factions/crimson_order --exclude=events
maas graph factions/crimson_order --out   # Outgoing only
maas graph factions/crimson_order --in    # Backlinks only
```

### `maas lint` (Phase 5+)

Check integrity of the knowledge graph.

```bash
maas lint           # Find broken links, orphans, duplicates
maas lint --fix     # Auto-remove dead edge rows
```

### `maas rename <old> <new>` (Phase 5+)

Rename a card and update all cross-file references.

```bash
maas rename factions/old_name factions/new_name
```

## Architecture

- `.maas/maas.db` — SQLite database (WAL mode, FTS5 full-text search)
- `.maas/config.yaml` — Project configuration
- One daemon per project root (auto-starts, auto-exits after 30min idle)
- Model cache at `~/.maas/models/` (shared across projects)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev          # Watch mode
```

---

## Claude Code Integration

> **Copy the section below into your `CLAUDE.md`, `skill.md`, or `agent.md` to teach Claude how to use Maas.**

---

### Maas — AI Agent Reference

Maas is a CLI that indexes `.md` files into a searchable knowledge graph. You query it via bash. You edit `.md` files directly with your normal tools.

**Card format**: `.md` files with optional `tags: [...]` frontmatter and `[[type/card_id]]` wiki-links. Card ID = filepath minus `.md`. Type = first directory segment.

**All output is YAML to stdout.**

#### Commands

```
maas init                              # Initialize project, index all .md files
maas ls                                # List all cards (id, title, type, tags, link counts)
maas ls --type=<type>                  # Filter by type
maas ls --tag=<tag>                    # Filter by tag
maas ls --orphans                      # Cards with no links in or out
maas ls --where <key>=<value>          # Filter by any frontmatter field (repeatable)
maas ls --search "<query>"             # Full-text search within card list
maas get <id>                          # Get card by exact ID (content + links_out + links_in)
maas get <shorthand>                   # Fuzzy resolve (errors if ambiguous with candidates)
maas convert <file>                    # Dry-run: check frontmatter, links, filenames
maas convert <file> --write            # Apply conversions
maas convert --all                     # Dry-run all .md files
maas convert --all --write             # Apply to all files
maas index                             # Full reindex
maas index --only <file>               # Reindex single file
maas index --check                     # Show stale/missing/new without writing
maas search "<query>"                  # Hybrid search (BM25 + semantic)
maas search "<query>" --type=<t>       # Filter search by type
maas search "<query>" --tag=<t>        # Filter search by tag
maas search "<query>" --limit=<n>      # Max results (default: 10)
maas search "<query>" --bm25           # Keyword search only
maas search "<query>" --semantic       # Semantic search only
maas graph <id>                        # Get card + connected neighborhood
maas graph <id> --depth=<n>            # Hops to follow (default: 1, max: 3)
maas graph <id> --max=<n>              # Max included cards (default: 20, max: 50)
maas graph <id> --out                  # Outgoing links only
maas graph <id> --in                   # Incoming links only (backlinks)
maas graph <id> --exclude=<types>      # Exclude types (comma-separated)
maas graph <id> --include=<t:detail>   # Type with detail level (full|summary|meta|id)
maas lint                              # Check broken links, orphans, duplicates
maas lint --fix                        # Remove dead edge rows
maas rename <old_id> <new_id>          # Rename card + update all [[refs]]
maas status                            # Daemon + index status
maas notify <file>                     # Fire-and-forget reindex trigger (for hooks)
maas stop                              # Stop background daemon
```

#### When to use

- "What do we know about X?" → `maas search "X"` then `maas get <id>`
- "How is X connected to Y?" → `maas graph <id> --depth=2`
- "Find related content" → `maas search` + `maas graph`
- "Check consistency" → `maas lint`
- "Rename/reorganize" → `maas rename`
- Adding/editing knowledge → edit the `.md` file directly, then `maas lint`

#### Rules

- Links must be exact IDs: `[[factions/crimson_order]]` not `[[crimson_order]]`
- Always verify IDs exist with `maas ls` or `maas search` before adding `[[links]]`
- After bulk edits, run `maas lint` to check for broken links
- The `.md` files are the source of truth — Maas is a read/query layer
- Never invent card IDs — always search first
