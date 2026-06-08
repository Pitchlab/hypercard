import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSerialQueue, acquireStartupLock, releaseStartupLock } from '../src/daemon/lifecycle.js';

describe('createSerialQueue', () => {
  it('runs tasks strictly one after another (no interleaving)', async () => {
    const queue = createSerialQueue();
    const events: string[] = [];

    const task = (name: string, delay: number) =>
      queue(async () => {
        events.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, delay));
        events.push(`${name}:end`);
      });

    // B is submitted second but with a shorter delay; without serialisation its
    // end would race ahead of A. The queue must keep them fully ordered.
    await Promise.all([task('A', 30), task('B', 1)]);

    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('keeps ordering even when a task rejects', async () => {
    const queue = createSerialQueue();
    const events: string[] = [];

    const a = queue(async () => {
      events.push('A');
      throw new Error('boom');
    });
    const b = queue(async () => {
      events.push('B');
    });

    await expect(a).rejects.toThrow('boom');
    await b;
    expect(events).toEqual(['A', 'B']);
  });
});

describe('acquireStartupLock', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercard-lock-test-'));
    fs.mkdirSync(path.join(tempDir, '.hypercard'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('grants the lock when none exists', () => {
    expect(acquireStartupLock(tempDir)).toBe(true);
  });

  it('refuses a second acquisition while a live holder owns it', () => {
    // First acquisition writes our own (live) pid into the lock.
    expect(acquireStartupLock(tempDir)).toBe(true);
    // Second acquisition sees a live holder (this process) and must refuse.
    expect(acquireStartupLock(tempDir)).toBe(false);
  });

  it('takes over a lock held by a dead pid', () => {
    const lockPath = path.join(tempDir, '.hypercard', 'daemon.lock');
    // PID 999999 is exceedingly unlikely to be alive.
    fs.writeFileSync(lockPath, '999999', 'utf-8');
    expect(acquireStartupLock(tempDir)).toBe(true);
  });

  it('releaseStartupLock removes the lock file', () => {
    acquireStartupLock(tempDir);
    releaseStartupLock(tempDir);
    expect(fs.existsSync(path.join(tempDir, '.hypercard', 'daemon.lock'))).toBe(false);
  });
});
