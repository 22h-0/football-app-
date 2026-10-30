import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
let html = await readFile(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<link\b[^>]*\brel="manifest"[^>]*>/gi, '');

async function asset(url) {
  const file = path.resolve(dist, url.replace(/^\//, ''));
  if (!file.startsWith(`${dist}${path.sep}`)) throw new Error(`Asset outside build directory: ${url}`);
  return readFile(file, 'utf8');
}

const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gi)];
if (scripts.length !== 1) throw new Error('Standalone build expects a single JavaScript bundle.');
for (const [tag, url] of scripts) {
  const source = (await asset(url)).replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, () => `<script type="module">${source}</script>`);
}
const styles = [...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"[^>]*>/gi)];
for (const [tag, url] of styles) {
  const css = (await asset(url)).replace(/<\/style/gi, '<\\/style');
  html = html.replace(tag, () => `<style>${css}</style>`);
}
const favicon = Buffer.from(await readFile(path.join(root, 'public/favicon.svg'))).toString('base64');
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${favicon}"`);
await mkdir(path.join(root, 'standalone'), { recursive: true });
await writeFile(path.join(root, 'standalone/Sideline.html'), html);
await writeFile(path.join(root, 'standalone/Sideline.txt'), html);
console.log('Standalone app created: standalone/Sideline.html — double-click to open in your browser.');
