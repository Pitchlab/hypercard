import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, getCardCount, getEdgeCount, getBrokenLinkCount, getTypes } from '../../core/db.js';
import { indexAllCards } from '../../core/indexer.js';
import { outputYaml } from '../../util/yaml.js';

const DEFAULT_CONFIG = `root: .
daemon:
  idle_timeout: 1800
  debounce: 200
  socket: maas.sock
watch:
  include: ["**/*.md"]
  exclude: ["**/node_modules/**", ".maas/**", "**/.*"]
index:
  max_content_length: 50000
`;

export async function initCommand(): Promise<void> {
  const projectRoot = process.cwd();
  const maasDir = path.join(projectRoot, '.maas');

  if (fs.existsSync(maasDir)) {
    process.stderr.write('Error: .maas/ already exists. Project already initialized.\n');
    process.exit(1);
  }

  fs.mkdirSync(maasDir, { recursive: true });
  fs.writeFileSync(path.join(maasDir, 'config.yaml'), DEFAULT_CONFIG, 'utf-8');

  const dbPath = path.join(maasDir, 'maas.db');
  const db = initDatabase(dbPath);

  process.stderr.write('Indexing all cards...');
  await indexAllCards(projectRoot, db);
  process.stderr.write(' done.\n');

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
