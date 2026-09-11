import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngSize(path) {
  const image = readFileSync(resolve(path));
  assert(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${path} is not PNG`);
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

const manifest = JSON.parse(readFileSync(resolve('dist/manifest.webmanifest'), 'utf8'));
assert(manifest.id === '/' && manifest.start_url === '/' && manifest.scope === '/', 'manifest identity is invalid');
assert(manifest.display === 'standalone', 'manifest must use standalone display');
assert(manifest.icons.some((icon) => icon.sizes === '192x192'), '192px icon is missing');
assert(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'), '512px icon is missing');
assert(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'), 'maskable icon is missing');

for (const [path, expected] of [
  ['dist/icons/icon-192.png', 192], ['dist/icons/icon-512.png', 512],
  ['dist/icons/icon-maskable-512.png', 512], ['dist/apple-touch-icon.png', 180],
]) {
  assert(existsSync(resolve(path)), `${path} is missing`);
  const [width, height] = pngSize(path);
  assert(width === expected && height === expected, `${path} has invalid dimensions ${width}x${height}`);
}

const html = readFileSync(resolve('dist/index.html'), 'utf8');
const worker = readFileSync(resolve('dist/sw.js'), 'utf8');
assert(html.includes('rel="manifest"') && html.includes('apple-touch-icon'), 'PWA links are missing from index.html');
assert(worker.includes("url.pathname.startsWith('/api/')"), 'service worker must exclude APIs');
assert(worker.includes("request.mode === 'navigate'") && worker.includes("caches.match(OFFLINE_URL)"), 'offline navigation fallback is missing');
assert(!worker.includes("cache.put('/api/"), 'service worker must not cache API data');

console.log(JSON.stringify({ ok: true, name: manifest.name, display: manifest.display, icons: manifest.icons.length,
  checks: ['manifest', '192-icon', '512-icon', 'maskable-icon', 'apple-touch-icon', 'service-worker', 'api-cache-exclusion', 'offline-fallback'] }));
