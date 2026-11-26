import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const schema = await readFile(new URL('../drizzle/0000_diary.sql', import.meta.url), 'utf8');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) {
      db.exec(schema);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

export function d1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => statement.get(...args) ?? null,
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({ meta: statement.run(...args) }),
          };
        },
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await Promise.all(statements.map((statement) => statement.run()));
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function startServer(worker, db, port = 3000) {
  return createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method;
      const url = new URL(incoming.url, 'http://127.0.0.1:' + incoming.socket.localPort);
      const headers = new Headers(incoming.headers);
      headers.set('CF-Connecting-IP', incoming.socket.remoteAddress ?? 'local');
      const body = !['GET', 'HEAD'].includes(method) ? Readable.toWeb(incoming) : undefined;
      const response = await worker.fetch(new Request(url, { method, headers, body, duplex: body ? 'half' : undefined }), { DB: d1(db) });
      const responseHeaders = Object.fromEntries(response.headers);
      if (response.headers.has('set-cookie')) responseHeaders['set-cookie'] = response.headers.getSetCookie();
      outgoing.writeHead(response.status, responseHeaders);
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
      else outgoing.end();
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  }).listen(port, '127.0.0.1');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./build.mjs');
  const { default: worker } = await import('../dist/server/index.js');
  const data = new URL('../data/', import.meta.url);
  await mkdir(data, { recursive: true });
  const db = await openDatabase(fileURLToPath(new URL('harugyeol.sqlite', data)));
  const server = startServer(worker, db, Number(process.env.PORT ?? 3000));
  server.on('listening', () => console.log('http://127.0.0.1:' + server.address().port));
}
