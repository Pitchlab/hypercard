import net from 'node:net';
import fs from 'node:fs';
import type { IProgressCallback } from '../core/types.js';

export interface ICommandHandler {
  handle(command: string, args: Record<string, unknown>, onProgress?: IProgressCallback): Promise<unknown>;
}

export function startServer(socketPath: string, handler: ICommandHandler): Promise<net.Server> {
  // Remove stale socket file if exists
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer((conn) => {
      let buffer = '';

      conn.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          handleLine(line, conn, handler);
        }
      });

      conn.on('error', (err) => {
        process.stderr.write(`[daemon] connection error: ${err.message}\n`);
      });
    });

    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      process.stderr.write(`[daemon] listening on ${socketPath}\n`);
      resolve(server);
    });

    server.on('error', (err) => {
      process.stderr.write(`[daemon] server error: ${err.message}\n`);
      reject(err);
    });
  });
}

async function handleLine(line: string, conn: net.Socket, handler: ICommandHandler): Promise<void> {
  let id = 'unknown';
  try {
    const request = JSON.parse(line);
    id = request.id ?? 'unknown';
    const { command, args } = request;

    if (!command || typeof command !== 'string') {
      sendResponse(conn, { id, success: false, error: { code: 'INVALID_REQUEST', message: 'Missing command' } });
      return;
    }

    // Create progress callback that streams to client
    const onProgress: IProgressCallback = (phase, current, total) => {
      sendResponse(conn, { id, progress: { phase, current, total } });
    };

    const data = await handler.handle(command, args ?? {}, onProgress);
    sendResponse(conn, { id, success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = extractErrorCode(message);
    sendResponse(conn, { id, success: false, error: { code, message } });
  }
}

function sendResponse(conn: net.Socket, response: Record<string, unknown>): void {
  if (!conn.destroyed) {
    conn.write(JSON.stringify(response) + '\n');
  }
}

function extractErrorCode(message: string): string {
  if (message.includes('not found') || message.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (message.includes('ambiguous')) return 'AMBIGUOUS_ID';
  if (message.includes('Invalid') || message.includes('INVALID')) return 'INVALID_REQUEST';
  return 'INTERNAL_ERROR';
}
