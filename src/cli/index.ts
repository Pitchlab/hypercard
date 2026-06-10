#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index.js';
import { getCommand } from './commands/get.js';
import { lsCommand } from './commands/ls.js';
import { convertCommand } from './commands/convert.js';
import { searchCommand } from './commands/search.js';
import { graphCommand } from './commands/graph.js';
import { notifyCommand } from './commands/notify.js';
import { statusCommand } from './commands/status.js';
import { startCommand } from './commands/start.js';
import { linkCommand } from './commands/link.js';
import { unlinkCommand } from './commands/unlink.js';
import { stopCommand } from './commands/stop.js';
import { suggestLinksCommand } from './commands/suggest-links.js';

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
    'All output is YAML to stdout. Errors go to stderr.\n' +
    'A background daemon auto-starts on first command and keeps the index hot.\n\n' +
    'Workflow:\n' +
    '  hypercard init                     # Initialize project, index all .md files\n' +
    '  hypercard ls                       # List all cards\n' +
    '  hypercard ls --where key=value     # Filter by frontmatter field\n' +
    '  hypercard ls --search "query"      # Full-text search in list\n' +
    '  hypercard get <id>                 # Read a card with its links\n' +
    '  hypercard search <query>           # Search across cards\n' +
    '  hypercard graph <id>               # Explore card neighborhood\n' +
    '  hypercard link <source> <target>   # Add a [[target]] link in source file\n' +
    '  hypercard unlink <source> <target> # Remove [[target]] links from source file\n' +
    '  hypercard status                   # Show daemon and index status\n' +
    '  hypercard stop                     # Stop the background daemon\n' +
    '  hypercard notify <file>            # Trigger reindex (for editor hooks)',
  )
  .version('0.3.0');

program
  .command('init')
  .description(
    'Initialize a new Hypercard project in the current directory.\n' +
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
    '  hypercard ls --search "warrior" --tag=antagonist  # Search + tag filter\n' +
    '  hypercard ls --after 2025-01-01    # Cards dated on/after a date\n' +
    '  hypercard ls --after 2025-01-01 --before 2025-03-31  # Date range\n\n' +
    'Temporal layer: each card has a canonical timestamp (a frontmatter date field\n' +
    '— date/created/published/... — falling back to file mtime). --after/--before\n' +
    'filter on it (time is a scalar — just an inclusive range).\n\n' +
    'Output: count, cards[] (id, title, type, tags, links_out, links_in)',
  )
  .option('--type <type>', 'Filter cards by type (first directory segment)')
  .option('--tag <tag>', 'Filter cards by tag (from YAML frontmatter)')
  .option('--where <filter...>', 'Filter by frontmatter key=value (repeatable, AND logic)')
  .option('--orphans', 'Show only orphan cards (no incoming or outgoing links)')
  .option('--search <query>', 'Full-text search using FTS5 (combines with --type, --tag, --where)')
  .option('--after <date>', 'Only cards with timestamp on/after this date (ISO, e.g. 2025-01-01)')
  .option('--before <date>', 'Only cards with timestamp on/before this date (inclusive of the day)')
  .action(lsCommand);

program
  .command('convert [file]')
  .description(
    'Convert markdown files to Hypercard format.\n' +
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
    'Search across all cards. Default mode is hybrid (BM25 + semantic, fused with RRF),\n' +
    'auto-falling back to BM25 when no embeddings exist yet.\n\n' +
    'Examples:\n' +
    '  hypercard search "crimson military"               # Hybrid (default)\n' +
    '  hypercard search "warriors" --mode semantic       # Pick retrieval mode\n' +
    '  hypercard search "crimson" --type=factions        # Filter by type\n' +
    '  hypercard search "trade" --tag=neutral            # Filter by tag\n' +
    '  hypercard search "crimson" --where status=published  # Filter by frontmatter\n' +
    '  hypercard search "crimson" --after 2025-01-01 --before 2025-06-30  # Date range\n' +
    '  hypercard search "crimson" --topk 20              # More results\n' +
    '  hypercard search "crimson" --format list          # One line per hit\n' +
    '  hypercard search "crimson" --traverse 1           # Include each hit\'s links\n\n' +
    'Filters (--type, --tag, --where, --after, --before) all combine with AND.\n' +
    '--format: list (compact one-liner), summary (default: +snippet), full (+content).\n' +
    '--traverse <depth> nests each hit\'s link neighborhood (compact) up to 3 hops.\n\n' +
    'Output: query, mode, format, count, results[] (shape depends on --format)',
  )
  .option('--mode <mode>', 'Retrieval mode: bm25 | semantic | hybrid (default: hybrid)', 'hybrid')
  .option('--type <type>', 'Filter by type')
  .option('--tag <tag>', 'Filter by tag')
  .option('--where <filter...>', 'Filter by frontmatter key=value (repeatable, AND logic)')
  .option('--after <date>', 'Only results with timestamp on/after this date (ISO, e.g. 2025-01-01)')
  .option('--before <date>', 'Only results with timestamp on/before this date (inclusive of the day)')
  .option('--topk <n>', 'Max results (default: 10)', '10')
  .option('--format <format>', 'Output detail: list | summary | full (default: summary)', 'summary')
  .option('--traverse <depth>', 'Include each hit\'s link neighborhood up to <depth> hops (1-3)')
  .action(searchCommand);

program
  .command('graph <id>')
  .description(
    'Explore a card\'s connected neighborhood via BFS traversal.\n\n' +
    'Examples:\n' +
    '  hypercard graph factions/crimson_order              # Default: depth 1, both directions\n' +
    '  hypercard graph crimson_order --depth=2             # Two hops\n' +
    '  hypercard graph crimson_order --out                 # Outgoing links only\n' +
    '  hypercard graph crimson_order --in                  # Incoming links only\n' +
    '  hypercard graph crimson_order --exclude=events      # Skip event cards\n' +
    '  hypercard graph crimson_order --max=5               # Limit included cards\n' +
    '  hypercard graph crimson_order --include=factions:full,characters:meta\n\n' +
    'Output: card (root at full detail), included[], truncated[], not_fetched[]',
  )
  .option('--depth <n>', 'Number of hops to follow (1-3, default: 1)', '1')
  .option('--max <n>', 'Maximum included cards (1-50, default: 20)', '20')
  .option('--out', 'Follow outgoing links only')
  .option('--in', 'Follow incoming links only')
  .option('--exclude <types>', 'Exclude card types (comma-separated)')
  .option('--include <mappings>', 'Type detail levels (comma-separated type:detail pairs)')
  .action(graphCommand);

program
  .command('suggest-links <id>')
  .description(
    'Suggest missing links based on semantic similarity and content analysis.\n\n' +
    'Finds cards that should be linked to the given card but are not.\n' +
    'Uses two strategies:\n' +
    '  - Semantic similarity: cards with similar embeddings\n' +
    '  - Mention detection: cards whose title or ID segment appears in content\n\n' +
    'Examples:\n' +
    '  hypercard suggest-links factions/rebels     # Suggest links for a card\n' +
    '  hypercard suggest-links rebels              # Fuzzy ID resolution\n' +
    '  hypercard suggest-links rebels --limit=5    # Limit results\n\n' +
    'Output: card (resolved ID), count, suggestions[] (target_id, target_title, reason, score)',
  )
  .option('--limit <n>', 'Maximum suggestions to return (default: 10)', '10')
  .action(suggestLinksCommand);

program
  .command('notify <file>')
  .description(
    'Fire-and-forget reindex trigger for editor hooks.\n' +
    'Sends the file path to the daemon for reindexing.\n' +
    'Silent on failure — safe to use in pre/post-save hooks.\n\n' +
    'Example hook (Claude Code):\n' +
    '  hypercard notify $FILE',
  )
  .action(notifyCommand);

program
  .command('status')
  .description(
    'Show daemon and index status.\n\n' +
    'Output: daemon (running/stopped), pid, uptime_seconds, cards, types, embeddings, embedder_loaded',
  )
  .action(statusCommand);

program
  .command('start')
  .description('Start the background daemon (auto-starts on any command, but this is explicit).')
  .action(startCommand);

program
  .command('stop')
  .description('Stop the background daemon and clean up socket/PID files.')
  .action(stopCommand);

program
  .command('link <source> <target>')
  .description(
    'Add a [[target]] wiki-link in the source card file.\n' +
    'Appends the link to the end of the first paragraph after the title.\n' +
    'No-op if the link already exists.\n\n' +
    'Examples:\n' +
    '  hypercard link factions/rebels characters/leia\n' +
    '  hypercard link rebels leia       # Fuzzy IDs supported\n\n' +
    'Output: command, source, target, added, line (or reason)',
  )
  .action(linkCommand);

program
  .command('unlink <source> <target>')
  .description(
    'Remove all [[target]] wiki-links from the source card file.\n' +
    'Removes both [[target]] and [[target|Display Text]] forms.\n\n' +
    'Examples:\n' +
    '  hypercard unlink factions/rebels characters/leia\n' +
    '  hypercard unlink rebels leia     # Fuzzy IDs supported\n\n' +
    'Output: command, source, target, removed, count (or reason)',
  )
  .action(unlinkCommand);

program.parse();
