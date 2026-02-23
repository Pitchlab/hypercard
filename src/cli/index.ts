#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index.js';
import { getCommand } from './commands/get.js';
import { lsCommand } from './commands/ls.js';
import { convertCommand } from './commands/convert.js';
import { searchCommand } from './commands/search.js';

const program = new Command();

program
  .name('hypercard')
  .description(
    'Markdown knowledge graph CLI.\n' +
    'Turns a folder of interconnected .md files into a queryable knowledge graph with hybrid search (BM25 + semantic).\n\n' +
    'Card format:\n' +
    '  - Each .md file is a "card" with optional YAML frontmatter (tags: [...], custom fields)\n' +
    '  - Cards link to each other with [[type/card_id]] or [[type/card_id|Display Text]]\n' +
    '  - Card ID = relative path without .md (e.g., factions/rebels.md → factions/rebels)\n' +
    '  - Card type = first directory segment (e.g., factions/rebels → type: factions)\n\n' +
    'All output is YAML to stdout. Errors go to stderr.\n\n' +
    'Workflow:\n' +
    '  hypercard init                     # Initialize project, index all .md files\n' +
    '  hypercard ls                       # List all cards\n' +
    '  hypercard ls --where key=value     # Filter by frontmatter field\n' +
    '  hypercard ls --search "query"      # Full-text search in list\n' +
    '  hypercard get <id>                 # Read a card with its links\n' +
    '  hypercard search <query>           # Hybrid search across cards (Phase 2)\n' +
    '  hypercard graph <id>               # Explore card neighborhood (Phase 2)\n' +
    '  hypercard lint                     # Check integrity (Phase 5)\n' +
    '  hypercard rename <old> <new>       # Rename card, update all refs (Phase 5)',
  )
  .version('0.1.0');

program
  .command('init')
  .description(
    'Initialize a new HyperCard project in the current directory.\n' +
    'Creates .hypercard/ with config.yaml and SQLite database.\n' +
    'Indexes all .md files under the current directory.\n\n' +
    'Output: initialized, root, cards (count), types, links (count), broken_links (count)',
  )
  .action(initCommand);

program
  .command('index')
  .description(
    'Reindex all cards, or check/reindex a specific file.\n\n' +
    'Examples:\n' +
    '  hypercard index                    # Full reindex of all .md files\n' +
    '  hypercard index --only factions/rebels.md   # Reindex single file\n' +
    '  hypercard index --check            # Dry run: show stale/missing/new without writing',
  )
  .option('--only <file>', 'Reindex a single file (relative path to .md file)')
  .option('--check', 'Dry run: show stale, missing, and new cards without modifying the index')
  .action(indexCommand);

program
  .command('get <id>')
  .description(
    'Fetch a single card by ID with its incoming and outgoing links.\n' +
    'Supports exact ID or fuzzy shorthand (errors if ambiguous).\n\n' +
    'Examples:\n' +
    '  hypercard get factions/rebels      # Exact ID\n' +
    '  hypercard get rebels               # Fuzzy: resolves if unambiguous\n' +
    '  hypercard get leia                 # Fuzzy: finds characters/leia\n\n' +
    'Output: card (id, path, title, type, tags, content, links_out, links_in)\n' +
    'Error: ambiguous_id (with candidates) or not_found',
  )
  .action(getCommand);

program
  .command('ls')
  .description(
    'List all cards in the index with link counts.\n\n' +
    'Examples:\n' +
    '  hypercard ls                       # All cards\n' +
    '  hypercard ls --type=factions       # Only faction cards\n' +
    '  hypercard ls --tag=military        # Only cards tagged "military"\n' +
    '  hypercard ls --where status=draft  # Filter by frontmatter key=value\n' +
    '  hypercard ls --where status=draft --where era=medieval  # Multiple filters (AND)\n' +
    '  hypercard ls --type=factions --where status=published   # Combine filters\n' +
    '  hypercard ls --orphans             # Cards with zero links in or out\n' +
    '  hypercard ls --search "crimson"    # Full-text search\n' +
    '  hypercard ls --search "military" --type=factions  # Search + type filter\n' +
    '  hypercard ls --search "warrior" --tag=antagonist  # Search + tag filter\n\n' +
    'Output: count, cards[] (id, title, type, tags, links_out, links_in)',
  )
  .option('--type <type>', 'Filter cards by type (first directory segment)')
  .option('--tag <tag>', 'Filter cards by tag (from YAML frontmatter)')
  .option('--where <filter...>', 'Filter by frontmatter key=value (repeatable, AND logic)')
  .option('--orphans', 'Show only orphan cards (no incoming or outgoing links)')
  .option('--search <query>', 'Full-text search using FTS5 (combines with --type, --tag, --where)')
  .action(lsCommand);

program
  .command('convert [file]')
  .description(
    'Convert markdown files to HyperCard format.\n' +
    'Ensures frontmatter with tags, resolves bare wiki-links to full paths,\n' +
    'and flags filename issues (spaces, uppercase, no type directory).\n' +
    'Dry-run by default.\n\n' +
    'Examples:\n' +
    '  hypercard convert notes.md          # Dry-run single file\n' +
    '  hypercard convert notes.md --write  # Apply changes\n' +
    '  hypercard convert --all             # Dry-run all .md files\n' +
    '  hypercard convert --all --write     # Apply to all files',
  )
  .option('--all', 'Convert all .md files in the project')
  .option('--write', 'Apply changes (default is dry-run)')
  .action(convertCommand);

program
  .command('search <query>')
  .description(
    'Search across all cards using BM25 full-text search.\n\n' +
    'Examples:\n' +
    '  hypercard search "crimson military"           # Basic search\n' +
    '  hypercard search "crimson" --type=factions    # Filter by type\n' +
    '  hypercard search "trade" --tag=neutral        # Filter by tag\n' +
    '  hypercard search "crimson" --limit=20         # More results\n' +
    '  hypercard search "crimson" --where status=published  # Filter by frontmatter\n\n' +
    'Output: query, mode, count, results[] (id, title, type, tags, score, snippet)',
  )
  .option('--type <type>', 'Filter by type')
  .option('--tag <tag>', 'Filter by tag')
  .option('--where <filter...>', 'Filter by frontmatter key=value (repeatable, AND logic)')
  .option('--limit <n>', 'Max results (default: 10)', '10')
  .option('--bm25', 'Use keyword search (default)')
  .option('--semantic', 'Use semantic search (not yet implemented)')
  .option('--hybrid', 'Use hybrid search (not yet implemented)')
  .action(searchCommand);

program.parse();
