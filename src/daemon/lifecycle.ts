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
