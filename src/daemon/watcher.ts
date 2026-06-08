import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import { indexSingleCard, removeCard } from '../core/indexer.js';
import { deriveCardId } from '../util/paths.js';
import { createSerialQueue } from './lifecycle.js';
import type { RunExclusive } from './lifecycle.js';

export interface IWatcherConfig {
  include: string[];
  exclude: string[];
  debounce: number;
}

export function startWatcher(
  projectRoot: string,
  db: Database.Database,
  config: IWatcherConfig,
  onActivity: () => void,
  runExclusive: RunExclusive = createSerialQueue(),
): FSWatcher {
  const pending = new Map<string, 'add' | 'change' | 'unlink'>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    const batch = new Map(pending);
    pending.clear();

    // Run the whole batch through the shared queue so it never interleaves with
    // an auto-reindex triggered by a concurrent query command.
    await runExclusive(async () => {
      for (const [filePath, event] of batch) {
        try {
          if (event === 'unlink') {
            const cardId = deriveCardId(filePath, projectRoot);
            removeCard(cardId, db);
            process.stderr.write(`[watcher] removed: ${cardId}\n`);
          } else {
            await indexSingleCard(filePath, projectRoot, db);
            const cardId = deriveCardId(filePath, projectRoot);
            process.stderr.write(`[watcher] indexed: ${cardId}\n`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[watcher] error processing ${filePath}: ${msg}\n`);
        }
      }
    });

    onActivity();
  };

  const scheduleFlush = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, config.debounce);
  };

  const watcher = chokidar.watch(config.include, {
    cwd: projectRoot,
    ignored: config.exclude,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('add', (relPath) => {
    const absPath = path.join(projectRoot, relPath);
    pending.set(absPath, 'add');
    scheduleFlush();
  });

  watcher.on('change', (relPath) => {
    const absPath = path.join(projectRoot, relPath);
    pending.set(absPath, 'change');
    scheduleFlush();
  });

  watcher.on('unlink', (relPath) => {
    const absPath = path.join(projectRoot, relPath);
    pending.set(absPath, 'unlink');
    scheduleFlush();
  });

  watcher.on('error', (err) => {
    process.stderr.write(`[watcher] error: ${err.message}\n`);
  });

  process.stderr.write(`[watcher] watching ${projectRoot}\n`);
  return watcher;
}
