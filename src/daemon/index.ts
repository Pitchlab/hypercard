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
  acquireStartupLock,
  releaseStartupLock,
  createSerialQueue,
} from './lifecycle.js';
import type { IConfig } from '../core/types.js';
import { loadEmbedder } from '../core/embedder.js';

export async function startDaemon(projectRoot: string): Promise<void> {
  // Exclusive startup: if another daemon is already coming up / running, bail
  // out cleanly instead of racing it and deleting its socket.
  if (!acquireStartupLock(projectRoot)) {
    process.stderr.write('[daemon] another daemon owns startup — exiting\n');
    process.exit(0);
  }

  process.stderr.write(`[daemon] starting for ${projectRoot}\n`);

  // Load config
  const configPath = path.join(projectRoot, '.hypercard', 'config.yaml');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = jsYaml.load(configContent) as IConfig;

  // Open database
  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);

  // One queue shared by the handler (auto-reindex / index) and the watcher so
  // their SQLite transactions can never interleave across an await.
  const runExclusive = createSerialQueue();

  // Create handler
  const handler = new CommandHandler({ db, projectRoot, runExclusive });

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
  const shutdown = (exitCode = 0): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    process.stderr.write('[daemon] shutting down...\n');
    try { idleTimer.clear(); } catch {}
    try { watcher.close(); } catch {}
    try { server.close(); } catch {}
    try { db.close(); } catch {}
    cleanupDaemonFiles(projectRoot);
    releaseStartupLock(projectRoot);
    process.stderr.write('[daemon] stopped\n');
    process.exit(exitCode);
  };

  // A crash must not leave a stale PID/socket/lock behind — clean up and exit.
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[daemon] uncaught exception: ${err?.stack ?? err}\n`);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[daemon] unhandled rejection: ${String(reason)}\n`);
    shutdown(1);
  });

  // Idle timer
  const idleTimeoutMs = (config.daemon?.idle_timeout ?? 1800) * 1000;
  const idleTimer = createIdleTimer(idleTimeoutMs, () => {
    process.stderr.write('[daemon] idle timeout, shutting down...\n');
    shutdown();
  });

  // Wrap handler to reset idle timer on every command. Must forward onProgress
  // or long-running commands (index) silently stream no progress to the client.
  const wrappedHandler = {
    async handle(
      command: string,
      args: Record<string, unknown>,
      onProgress?: import('../core/types.js').IProgressCallback,
    ): Promise<unknown> {
      idleTimer.reset();
      return handler.handle(command, args, onProgress);
    },
  };

  // Start watcher
  const watcherConfig: IWatcherConfig = {
    include: config.watch?.include ?? ['**/*.md'],
    exclude: (config.watch?.exclude ?? ['**/node_modules/**', '.hypercard/**', '**/.*']).map((p) =>
      p === 'node_modules/**' ? '**/node_modules/**' : p,
    ),
    debounce: config.daemon?.debounce ?? 200,
  };
  const watcher = startWatcher(projectRoot, db, watcherConfig, () => idleTimer.reset(), runExclusive);

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
    // Startup failed after (possibly) acquiring the lock — release it so the
    // next invocation isn't blocked by our corpse.
    releaseStartupLock(projectRoot);
    cleanupDaemonFiles(projectRoot);
    process.exit(1);
  });
}
