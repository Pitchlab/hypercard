import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, getCardCount, getEdgeCount, getBrokenLinkCount, getTypes } from '../../core/db.js';
import { indexAllCards } from '../../core/indexer.js';
import { outputYaml } from '../../util/yaml.js';

const DEFAULT_CONFIG = `root: .
daemon:
  idle_timeout: 1800
  debounce: 200
  socket: hypercard.sock
watch:
  include: ["**/*.md"]
  exclude: ["node_modules/**", ".hypercard/**", "**/.*"]
index:
  max_content_length: 50000
`;

export async function initCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const hypercardDir = path.join(projectRoot, '.hypercard');

  if (fs.existsSync(hypercardDir)) {
    process.stderr.write('Error: .hypercard/ already exists. Project already initialized.\n');
    process.exit(1);
  }

  fs.mkdirSync(hypercardDir, { recursive: true });
  fs.writeFileSync(path.join(hypercardDir, 'config.yaml'), DEFAULT_CONFIG, 'utf-8');

  const dbPath = path.join(hypercardDir, 'hypercard.db');
  const db = initDatabase(dbPath);

  indexAllCards(projectRoot, db);

  const cards = getCardCount(db);
  const types = getTypes(db);
  const links = getEdgeCount(db);
  const broken_links = getBrokenLinkCount(db);

  db.close();

  outputYaml({
    initialized: true,
    root: projectRoot,
    cards,
    types,
    links,
    broken_links,
  });
}
