import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

const input = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const mime = {
  'login.html': 'text/html; charset=utf-8',
  'diary.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'main.js': 'text/javascript; charset=utf-8',
};
const assets = {};
for (const [name, type] of Object.entries(mime)) {
  assets[name] = { type, body: await input('../web/' + name) };
}
const server = new URL('../dist/server/', import.meta.url);
const meta = new URL('../dist/.openai/', import.meta.url);
await mkdir(server, { recursive: true });
await mkdir(meta, { recursive: true });
const worker = (await input('../worker.mjs'))
  .replace("import assets from './assets.mjs';", 'const assets = ' + JSON.stringify(assets) + ';');
await writeFile(new URL('index.js', server), worker);
await copyFile(new URL('../.openai/hosting.json', import.meta.url), new URL('hosting.json', meta));
console.log('Worker built');
