import fs from 'node:fs';
import path from 'node:path';

export function writePidFile(projectRoot: string): void {
  const pidPath = path.join(projectRoot, '.hypercard', 'daemon.pid');
  fs.writeFileSync(pidPath, String(process.pid), 'utf-8');
}

export function writeReadyFile(projectRoot: string): void {
  const readyPath = path.join(projectRoot, '.hypercard', 'daemon.ready');
  fs.writeFileSync(readyPath, String(Date.now()), 'utf-8');
}

export function removePidFile(projectRoot: string): void {
  const pidPath = path.join(projectRoot, '.hypercard', 'daemon.pid');
  try { fs.unlinkSync(pidPath); } catch {}
}

export function removeReadyFile(projectRoot: string): void {
  const readyPath = path.join(projectRoot, '.hypercard', 'daemon.ready');
  try { fs.unlinkSync(readyPath); } catch {}
}

export function removeSocketFile(projectRoot: string): void {
  const socketPath = path.join(projectRoot, '.hypercard', 'hypercard.sock');
  try { fs.unlinkSync(socketPath); } catch {}
}

export function readPidFile(projectRoot: string): number | null {
  const pidPath = path.join(projectRoot, '.hypercard', 'daemon.pid');
  try {
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isDaemonRunning(projectRoot: string): boolean {
  const pid = readPidFile(projectRoot);
  if (pid === null) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Process not running, clean up stale files
    cleanupDaemonFiles(projectRoot);
    return false;
  }
}

export function cleanupDaemonFiles(projectRoot: string): void {
  removePidFile(projectRoot);
  removeReadyFile(projectRoot);
  removeSocketFile(projectRoot);
}

/**
 * Acquire an exclusive startup lock so two daemons spawned near-simultaneously
 * (e.g. parallel CLI calls) can't both proceed — which previously had the second
 * daemon delete the first's freshly-created socket. Returns false if a live
 * daemon already holds the lock; the caller should then exit cleanly.
 */
export function acquireStartupLock(projectRoot: string): boolean {
  const lockPath = path.join(projectRoot, '.hypercard', 'daemon.lock');
  try {
    const fd = fs.openSync(lockPath, 'wx'); // O_EXCL: fails if the lock exists
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    // Lock present — only take it over if the holder is dead.
    let holder = NaN;
    try {
      holder = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
    } catch {
      // unreadable — treat as stale
    }
    if (!Number.isNaN(holder)) {
      try {
        process.kill(holder, 0);
        return false; // holder alive — someone else owns startup
      } catch {
        // holder dead — fall through to take over
      }
    }
    try {
      fs.writeFileSync(lockPath, String(process.pid), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}

export function releaseStartupLock(projectRoot: string): void {
  const lockPath = path.join(projectRoot, '.hypercard', 'daemon.lock');
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // already gone
  }
}

/**
 * Serialise async work so two callers can never interleave (critical for
 * better-sqlite3: overlapping `db.transaction()` calls across an `await` yield
 * throw "cannot start a transaction within a transaction"). Each submitted task
 * runs only after the previous one settles.
 */
export type RunExclusive = <T>(fn: () => Promise<T> | T) => Promise<T>;

export function createSerialQueue(): RunExclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = tail.then(() => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  };
}

export function createIdleTimer(timeoutMs: number, onIdle: () => void): { reset: () => void; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reset = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(onIdle, timeoutMs);
  };

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Start the timer immediately
  reset();

  return { reset, clear };
}

export function setupSignalHandlers(cleanup: () => void): void {
  let shuttingDown = false;

  const handler = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[daemon] received ${signal}, shutting down...\n`);
    cleanup();
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}
