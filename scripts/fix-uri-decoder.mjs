import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const file = createRequire(require.resolve('expo-router/package.json')).resolve('query-string');
const source = readFileSync(file, 'utf8');
const original = "const decodeComponent = require('decode-uri-component');";
const patched = "const decodeComponent = require('decode-uri-component').default;";

// shortcut: query-string 7 needs default interop; remove when Expo updates its query parser.
if (!source.includes(patched)) {
  if (!source.includes(original)) throw new Error('Unexpected query-string decoder import; review the compatibility patch');
  writeFileSync(file, source.replace(original, patched));
}
