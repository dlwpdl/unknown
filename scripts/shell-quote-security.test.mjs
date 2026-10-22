import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { quote } = require('shell-quote');

test('build quoting cannot execute a command after a comment token and newline', () => {
  // Benign sentinel only: no files, network, credentials or arbitrary supplied code.
  let command;
  try { command = quote([{ comment:'fixture' }, '\nprintf GLING_QUOTE_SENTINEL']); }
  catch { return; } // Rejecting this unsupported input is also safe.
  const result = spawnSync('/bin/sh', ['-c', `printf '%s' ${command}`], { encoding:'utf8' });
  assert.equal(result.stdout.includes('GLING_QUOTE_SENTINEL'), false);
});
test('ordinary arguments retain spaces and punctuation through build quoting', () => {
  const value = 'Gling 한글 & two words';
  const result = spawnSync('/bin/sh', ['-c', `printf '%s' ${quote([value])}`], { encoding:'utf8' });
  assert.equal(result.status,0); assert.equal(result.stdout,value);
});
