import fs from 'node:fs';
import path from 'node:path';
import jsYaml from 'js-yaml';
import { initDatabase } from '../core/db.js';
import { startServer } from './server.js';
import { CommandHandler } from './handler.js';
import { startWatcher } from './watcher.js';
import type { IWatcherConfig } from './watcher.js';
import {
  writePidFile,
  writeReadyFile,
  cleanupDaemonFiles,
  createIdleTimer,
  setupSignalHandlers,
} from './lifecycle.js';
import type { IConfig } from '../core/types.js';
import { loadEmbedder } from '../core/embedder.js';

export async function startDaemon(projectRoot: string): Promise<void> {
  process.stderr.write(`[daemon] starting for ${projectRoot}\n`);

  // Load config
  const configPath = path.join(projectRoot, '.hypercard', 'config.yaml');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = jsYaml.load(configContent) as IConfig;

  // Open database
  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);

  // Create handler
  const handler = new CommandHandler({ db, projectRoot });

  // Warm-load embedding model (non-blocking — daemon is usable before model loads)
  loadEmbedder().then((embedder) => {
    handler.setEmbedder(embedder);
    process.stderr.write('[daemon] embedder loaded\n');
  }).catch((err) => {
    process.stderr.write(`[daemon] embedder failed to load: ${err}\n`);
  });

  // Socket path
  const socketPath = path.join(projectRoot, '.hypercard', config.daemon?.socket ?? 'hypercard.sock');

  // Cleanup stale files
  cleanupDaemonFiles(projectRoot);

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = (): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    process.stderr.write('[daemon] shutting down...\n');
    idleTimer.clear();
    watcher.close();
    server.close();
    db.close();
    cleanupDaemonFiles(projectRoot);
    process.stderr.write('[daemon] stopped\n');
    process.exit(0);
  };

  // Idle timer
  const idleTimeoutMs = (config.daemon?.idle_timeout ?? 1800) * 1000;
  const idleTimer = createIdleTimer(idleTimeoutMs, () => {
    process.stderr.write('[daemon] idle timeout, shutting down...\n');
    shutdown();
  });

  // Wrap handler to reset idle timer on every command
  const wrappedHandler = {
    async handle(command: string, args: Record<string, unknown>): Promise<unknown> {
      idleTimer.reset();
      return handler.handle(command, args);
    },
  };

  // Start watcher
  const watcherConfig: IWatcherConfig = {
    include: config.watch?.include ?? ['**/*.md'],
    exclude: config.watch?.exclude ?? ['node_modules/**', '.hypercard/**', '**/.*'],
    debounce: config.daemon?.debounce ?? 200,
  };
  const watcher = startWatcher(projectRoot, db, watcherConfig, () => idleTimer.reset());

  // Start server (await to ensure socket is listening before signaling ready)
  const server = await startServer(socketPath, wrappedHandler);

  // Write PID and ready files (AFTER server is listening)
  writePidFile(projectRoot);
  writeReadyFile(projectRoot);

  // Signal handlers
  setupSignalHandlers(shutdown);

  process.stderr.write(`[daemon] ready (pid ${process.pid})\n`);
}

// Allow running directly: node dist/daemon/index.js <projectRoot>
const projectRoot = process.argv[2];
if (projectRoot) {
  startDaemon(projectRoot).catch((err) => {
    process.stderr.write(`Daemon error: ${err}\n`);
    process.exit(1);
  });
}
