import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

run('npm.cmd', ['run', 'build']);
run('npx.cmd', ['cap', 'sync', 'android']);

const config = JSON.parse(read('capacitor.config.json'));
assert(config.appId === 'com.bdfzscc.campuscycle', 'Capacitor appId mismatch');
assert(config.appName === '校园循环站', 'Capacitor app name mismatch');
assert(config.webDir === 'dist', 'Capacitor webDir must be dist');
assert(config.server?.androidScheme === 'https', 'Android WebView must use HTTPS scheme');
assert(existsSync(join(root, 'android/app/src/main/AndroidManifest.xml')), 'Android platform is missing');

const platform = read('src/platform.ts');
assert(platform.includes("https://cycle.bdfzscc.com"), 'native API origin must use the production HTTPS domain');
assert(!platform.includes('81.70.105.32'), 'server IP must not be embedded in the app');
assert(read('src/main.tsx').includes("!isNativeApp && 'serviceWorker' in navigator"), 'service worker must be disabled in native mode');

const manifest = read('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('android.permission.INTERNET'), 'Android INTERNET permission is missing');
for (const permission of ['ACCESS_FINE_LOCATION', 'READ_CONTACTS', 'READ_SMS', 'RECORD_AUDIO', 'READ_MEDIA_IMAGES', 'READ_EXTERNAL_STORAGE']) {
  assert(!manifest.includes(permission), `unnecessary Android permission found: ${permission}`);
}
assert(existsSync(join(root, 'android/app/src/main/res/drawable/cycle_station_mark.xml')), 'custom launcher/splash mark is missing');

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : statSync(path).size <= 2_000_000 ? [path] : [];
  });
}

const packagedRoots = [join(root, 'dist'), join(root, 'android/app/src/main/assets/public')].filter(existsSync);
const forbidden = [/OPENROUTER_API_KEY/i, /TEACHER_PASSWORD/i, /sk-or-v1-[A-Za-z0-9_-]+/i, /81\.70\.105\.32/];
for (const directory of packagedRoots) {
  for (const file of filesUnder(directory)) {
    const content = readFileSync(file);
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    for (const pattern of forbidden) assert(!pattern.test(text), `sensitive/server-only value found in packaged asset: ${file}`);
  }
}

console.log('app:check passed: config, platform, HTTPS API, permissions, native SW isolation, branding and packaged-secret scan');
