import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// These pure source helpers now validate canonical places against bundled JSON.
// Use the same real modules in Node fixtures without changing Metro's imports.
const root = fileURLToPath(new URL('../', import.meta.url)), cache = new Map(), nativeRequire = createRequire(import.meta.url);
function load(path) {
  if (!existsSync(path)) path += '.ts';
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} }; cache.set(path, module);
  if (path.endsWith('.json')) module.exports = JSON.parse(readFileSync(path, 'utf8'));
  else {
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = name => name.startsWith('@/') ? load(resolve(root, 'src', name.slice(2))) : name.startsWith('.') ? load(resolve(dirname(path), name)) : nativeRequire(name);
    vm.runInThisContext(`(function(exports,require,module){${code}\n})`, { filename: path })(module.exports, require, module);
  }
  return module.exports;
}
export const meetupDestination = load(resolve(root, 'src/lib/meetup-destination.ts'));
export const { splitEventMeetupBody, visibleMeetupBody } = load(resolve(root, 'src/lib/meetup-ai.ts'));
export const translationSource = load(resolve(root, 'src/lib/translation-source.ts'));
export const { visibleTranslationSource, needsContentTranslation } = translationSource;
