import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDaemonRunning, readPidFile } from '../daemon/lifecycle.js';

export interface IDaemonResponse {
  id: string;
  success?: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  progress?: { phase: string; current: number; total: number };
}

export type IProgressCallback = (phase: string, current: number, total: number) => void;

export async function sendCommand(
  projectRoot: string,
  command: string,
  args: Record<string, unknown> = {},
  onProgress?: IProgressCallback,
): Promise<unknown> {
  const socketPath = path.join(projectRoot, '.hypercard', 'hypercard.sock');

  // If daemon is already running, use it
  if (fs.existsSync(socketPath) && isDaemonRunning(projectRoot)) {
    try {
      return await sendToSocket(socketPath, command, args, onProgress);
    } catch {
      // Daemon connection failed — fall through to local
    }
  }

  // Run locally (fast, no daemon needed)
  const result = await handleLocally(projectRoot, command, args, onProgress);

  // Start daemon in background for future commands (fire-and-forget)
  launchDaemonBackground(projectRoot);

  return result;
}

async function sendToSocket(
  socketPath: string,
  command: string,
  args: Record<string, unknown>,
  onProgress?: IProgressCallback,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const conn = net.createConnection(socketPath);
    let buffer = '';
    const timeoutMs = command === 'index' ? 300000 : 10000; // 5min for index, 10s for others
    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error(`Daemon did not respond within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    conn.on('connect', () => {
      const request = JSON.stringify({ id, command, args }) + '\n';
      conn.write(request);
    });

    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response: IDaemonResponse = JSON.parse(line);
          if (response.id === id) {
            // Progress message — not the final response
            if (response.progress) {
              if (onProgress) {
                onProgress(response.progress.phase, response.progress.current, response.progress.total);
              }
              continue;
            }

            clearTimeout(timeout);
            conn.end();
            if (response.success) {
              resolve(response.data);
            } else {
              const err = new Error(response.error?.message ?? 'Unknown daemon error');
              (err as Error & { code: string }).code = response.error?.code ?? 'UNKNOWN';
              reject(err);
            }
          }
        } catch {
          // Ignore malformed lines
        }
      }
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to daemon: ${err.message}`));
    });
  });
}

/**
 * Spawn the detached daemon, redirecting its stdout/stderr to
 * `.hypercard/daemon.log` so a startup crash is diagnosable instead of vanishing
 * into /dev/null. Returns the entry path used (for callers that wait on ready).
 */
function spawnDaemon(projectRoot: string): void {
  const thisDir = new URL('.', import.meta.url).pathname;
  const daemonEntry = path.resolve(thisDir, '..', 'daemon', 'index.js');

  let stdio: 'ignore' | ['ignore', number, number] = 'ignore';
  try {
    const logFd = fs.openSync(path.join(projectRoot, '.hypercard', 'daemon.log'), 'a');
    stdio = ['ignore', logFd, logFd];
  } catch {
    // Can't open log — fall back to discarding output rather than failing.
  }

  const child = spawn(process.execPath, [daemonEntry, projectRoot], {
    detached: true,
    stdio,
    env: { ...process.env },
  });
  child.unref();
}

function launchDaemonBackground(projectRoot: string): void {
  try {
    // Don't launch if already running
    if (isDaemonRunning(projectRoot)) return;
    spawnDaemon(projectRoot);
  } catch {
    // Best-effort — don't fail if daemon can't start
  }
}

export async function ensureDaemon(projectRoot: string): Promise<void> {
  if (isDaemonRunning(projectRoot)) return;

  process.stderr.write(`[cli] starting daemon for ${projectRoot}...\n`);
  spawnDaemon(projectRoot);

  // Wait for ready signal
  const readyPath = path.join(projectRoot, '.hypercard', 'daemon.ready');
  const maxWait = 5000;
  const interval = 50;
  let elapsed = 0;

  while (elapsed < maxWait) {
    if (fs.existsSync(readyPath)) {
      process.stderr.write(`[cli] daemon ready (pid ${readPidFile(projectRoot)})\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
    elapsed += interval;
  }

  // Surface why it failed — the daemon log usually holds the real error
  // (missing config, port in use, model load failure), instead of a bare timeout.
  const logPath = path.join(projectRoot, '.hypercard', 'daemon.log');
  let tail = '';
  try {
    const log = fs.readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    tail = log.slice(-5).join('\n');
  } catch {
    // no log
  }
  throw new Error(
    `Daemon did not become ready within 5s.${tail ? ` Recent daemon log:\n${tail}` : ''}`,
  );
}

export async function sendNotify(projectRoot: string, filePath: string): Promise<void> {
  try {
    const socketPath = path.join(projectRoot, '.hypercard', 'hypercard.sock');
    if (!fs.existsSync(socketPath)) return; // Daemon not running, silently skip
    await sendToSocket(socketPath, 'index', { only: filePath });
  } catch {
    // Fire-and-forget: never fail
  }
}

async function handleLocally(
  projectRoot: string,
  command: string,
  args: Record<string, unknown>,
  onProgress?: IProgressCallback,
): Promise<unknown> {
  const { initDatabase } = await import('../core/db.js');
  const { CommandHandler } = await import('../daemon/handler.js');
  const dbPath = path.join(projectRoot, '.hypercard', 'hypercard.db');
  const db = initDatabase(dbPath);
  try {
    const handler = new CommandHandler({ db, projectRoot });
    return await handler.handle(command, args, onProgress);
  } finally {
    db.close();
  }
}
