import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Granular chunking splits each page's JavaScript over many files. Without a browser in CI, prove the plan is whole:
// every module a page runs synchronously must already be in that page's <script> files, and every dynamic import must
// name files that exist and complete its own graph. Module factories are only collected, never run.
const definitions = new Map();
function chunk(directory, src) {
  if (definitions.has(src)) return definitions.get(src);
  const file = join(directory, src.replace(/^\//, ''));
  assert.ok(existsSync(file), `Missing JavaScript chunk: ${src}`);
  const modules = new Map(), entries = [];
  const sandbox = {
    __d: (factory, id, dependencies) => { modules.set(id, { factory: String(factory), dependencies: dependencies ?? [] }); },
    __r: id => { entries.push(id); }, __registerSegment() {}, process: { env: {} },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: src });
  const result = { modules, entries };
  definitions.set(src, result);
  return result;
}

function edges(module) {
  const map = module.factory.match(/^function\s*\(([^)]*)\)/)?.[1].split(',').at(-1)?.trim() ?? 'd';
  const at = index => `${map}\\[${index}\\]`;
  const sync = [], async = [];
  // Plain array, or an indexed object when it carries async `paths`.
  for (const [index, id] of Object.entries(module.dependencies)) {
    if (!/^\d+$/.test(index) || id === null) continue;
    const all = module.factory.match(new RegExp(at(index), 'g'))?.length ?? 0;
    const lazy = module.factory.match(new RegExp(`\\(${at(index)},${map}\\.paths[,)]`, 'g'))?.length ?? 0;
    if (lazy) async.push(id);
    if (all > lazy) sync.push(id);
  }
  return { sync, async };
}

export function checkWebChunks(directory, page) {
  const html = readFileSync(join(directory, page), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)].map(match => match[1]);
  assert.ok(scripts.length, `${page} has no scripts`);
  const loaded = new Map(), entries = [];
  const load = src => { const { modules, entries: run } = chunk(directory, src); for (const [id, module] of modules) loaded.set(id, module); return run; };
  for (const src of scripts) entries.push(...load(src));
  assert.ok(entries.length, `${page} never starts its entry module`);
  const seen = new Set(), queue = [...entries];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const module = loaded.get(id);
    assert.ok(module, `${page}: module ${id} is required before any of its scripts define it`);
    const { sync, async } = edges(module);
    queue.push(...sync);
    for (const target of async) {
      // Legacy chunking has no `paths` for modules already in the page; granular lists every file the import needs.
      const files = module.dependencies.paths?.[target];
      if (files) for (const src of [files].flat()) load(src);
      queue.push(target);
    }
  }
  return seen.size;
}
