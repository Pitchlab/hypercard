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
  .name('maas')
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
    '  maas init                     # Initialize project, index all .md files\n' +
    '  maas ls                       # List all cards\n' +
    '  maas ls --where key=value     # Filter by frontmatter field\n' +
    '  maas ls --search "query"      # Full-text search in list\n' +
    '  maas get <id>                 # Read a card with its links\n' +
    '  maas search <query>           # Search across cards\n' +
    '  maas graph <id>               # Explore card neighborhood\n' +
    '  maas link <source> <target>   # Add a [[target]] link in source file\n' +
    '  maas unlink <source> <target> # Remove [[target]] links from source file\n' +
    '  maas status                   # Show daemon and index status\n' +
    '  maas stop                     # Stop the background daemon\n' +
    '  maas notify <file>            # Trigger reindex (for editor hooks)',
  )
  .version('0.3.0');

program
  .command('init')
  .description(
    'Initialize a new Maas project in the current directory.\n' +
    'Creates .maas/ with config.yaml and SQLite database.\n' +
    'Indexes all .md files under the current directory.\n\n' +
    'Output: initialized, root, cards (count), types, links (count), broken_links (count)',
  )
  .action(initCommand);

program
  .command('index')
  .description(
    'Reindex all cards, or check/reindex a specific file.\n\n' +
    'Examples:\n' +
    '  maas index                    # Full reindex of all .md files\n' +
    '  maas index --only factions/rebels.md   # Reindex single file\n' +
    '  maas index --check            # Dry run: show stale/missing/new without writing',
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
    '  maas get factions/rebels      # Exact ID\n' +
    '  maas get rebels               # Fuzzy: resolves if unambiguous\n' +
    '  maas get leia                 # Fuzzy: finds characters/leia\n\n' +
    'Output: card (id, path, title, type, tags, content, links_out, links_in)\n' +
    'Error: ambiguous_id (with candidates) or not_found',
  )
  .action(getCommand);

program
  .command('ls')
  .description(
    'List all cards in the index with link counts.\n\n' +
    'Examples:\n' +
    '  maas ls                       # All cards\n' +
    '  maas ls --type=factions       # Only faction cards\n' +
    '  maas ls --tag=military        # Only cards tagged "military"\n' +
    '  maas ls --where status=draft  # Filter by frontmatter key=value\n' +
    '  maas ls --where status=draft --where era=medieval  # Multiple filters (AND)\n' +
    '  maas ls --type=factions --where status=published   # Combine filters\n' +
    '  maas ls --orphans             # Cards with zero links in or out\n' +
    '  maas ls --search "crimson"    # Full-text search\n' +
    '  maas ls --search "military" --type=factions  # Search + type filter\n' +
    '  maas ls --search "warrior" --tag=antagonist  # Search + tag filter\n\n' +
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
    'Convert markdown files to Maas format.\n' +
    'Ensures frontmatter with tags, resolves bare wiki-links to full paths,\n' +
    'and flags filename issues (spaces, uppercase, no type directory).\n' +
    'Dry-run by default.\n\n' +
    'Examples:\n' +
    '  maas convert notes.md          # Dry-run single file\n' +
    '  maas convert notes.md --write  # Apply changes\n' +
    '  maas convert --all             # Dry-run all .md files\n' +
    '  maas convert --all --write     # Apply to all files',
  )
  .option('--all', 'Convert all .md files in the project')
  .option('--write', 'Apply changes (default is dry-run)')
  .action(convertCommand);

program
  .command('search <query>')
  .description(
    'Search across all cards using BM25 full-text search.\n\n' +
    'Examples:\n' +
    '  maas search "crimson military"           # Basic search\n' +
    '  maas search "crimson" --type=factions    # Filter by type\n' +
    '  maas search "trade" --tag=neutral        # Filter by tag\n' +
    '  maas search "crimson" --limit=20         # More results\n' +
    '  maas search "crimson" --where status=published  # Filter by frontmatter\n\n' +
    'Output: query, mode, count, results[] (id, title, type, tags, score, snippet)',
  )
  .option('--type <type>', 'Filter by type')
  .option('--tag <tag>', 'Filter by tag')
  .option('--where <filter...>', 'Filter by frontmatter key=value (repeatable, AND logic)')
  .option('--limit <n>', 'Max results (default: 10)', '10')
  .option('--bm25', 'Use keyword search (default)')
  .option('--semantic', 'Use semantic vector search')
  .option('--hybrid', 'Use hybrid BM25 + semantic search')
  .action(searchCommand);

program
  .command('graph <id>')
  .description(
    'Explore a card\'s connected neighborhood via BFS traversal.\n\n' +
    'Examples:\n' +
    '  maas graph factions/crimson_order              # Default: depth 1, both directions\n' +
    '  maas graph crimson_order --depth=2             # Two hops\n' +
    '  maas graph crimson_order --out                 # Outgoing links only\n' +
    '  maas graph crimson_order --in                  # Incoming links only\n' +
    '  maas graph crimson_order --exclude=events      # Skip event cards\n' +
    '  maas graph crimson_order --max=5               # Limit included cards\n' +
    '  maas graph crimson_order --include=factions:full,characters:meta\n\n' +
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
    '  maas suggest-links factions/rebels     # Suggest links for a card\n' +
    '  maas suggest-links rebels              # Fuzzy ID resolution\n' +
    '  maas suggest-links rebels --limit=5    # Limit results\n\n' +
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
    '  maas notify $FILE',
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
    '  maas link factions/rebels characters/leia\n' +
    '  maas link rebels leia       # Fuzzy IDs supported\n\n' +
    'Output: command, source, target, added, line (or reason)',
  )
  .action(linkCommand);

program
  .command('unlink <source> <target>')
  .description(
    'Remove all [[target]] wiki-links from the source card file.\n' +
    'Removes both [[target]] and [[target|Display Text]] forms.\n\n' +
    'Examples:\n' +
    '  maas unlink factions/rebels characters/leia\n' +
    '  maas unlink rebels leia     # Fuzzy IDs supported\n\n' +
    'Output: command, source, target, removed, count (or reason)',
  )
  .action(unlinkCommand);

program.parse();
