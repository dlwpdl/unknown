import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function buildVercelOutput(dist, output) {
  rmSync(output, { recursive: true, force: true });
  const functionDirectory = join(output, 'functions/_gling-share-preview.func');
  mkdirSync(functionDirectory, { recursive: true });
  cpSync(dist, join(output, 'static'), { recursive: true });
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--strict', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2022,dom', '--types', 'node', '--skipLibCheck', '--rewriteRelativeImportExtensions', '--noEmitOnError', '--outDir', functionDirectory, 'infra/node-share-preview.ts'], { cwd: root, stdio: 'inherit' });
  writeFileSync(join(functionDirectory, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'node-share-preview.js', launcherType: 'Nodejs' }, null, 2) + '\n');
  writeFileSync(join(functionDirectory, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
  writeFileSync(join(output, 'config.json'), JSON.stringify({ version: 3, routes: [
    { src: '^/_gling-share-preview(?:/.*)?$', dest: '/404.html', status: 404 },
    { src: '^/(?:auth|merchant/auth)(?:/.*)?$', dest: '/404.html', status: 404 },
    { src: '^/share/([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/?$', dest: '/_gling-share-preview?__gling_share_id=$1', missing: [{ type: 'query', key: '__gling_share_id' }] },
    { handle: 'filesystem' },
    { src: '^/$', dest: '/index.html' },
    { src: '^/merchant/?$', dest: '/merchant/index.html' },
    { src: '^/(.*)/$', dest: '/$1/index.html', check: true },
    { src: '^/(.+?)/?$', dest: '/$1.html', check: true },
    { src: '^/.*$', dest: '/404.html', status: 404 },
  ] }, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildVercelOutput(join(root, 'dist'), join(root, '.vercel/output'));
