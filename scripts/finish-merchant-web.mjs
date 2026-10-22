import assert from 'node:assert/strict';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkMerchantWeb } from './check-merchant-web.mjs';

export function finishMerchantWeb(source = '.merchant-dist', directory = 'dist') {
  const destination = join(directory, 'merchant');
  assert.ok(existsSync(join(directory, 'index.html')), 'Build the public web before adding merchant web.');
  assert.notEqual(resolve(source), resolve(destination), 'Merchant source cannot be its destination.');
  checkMerchantWeb(source);
  // Validate first, then replace only the generated merchant subtree.
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  finishMerchantWeb(process.argv[2], process.argv[3]);
}
