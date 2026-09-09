// Run with Metro on 8091 and an existing Gling Orca tab: node scripts/check-review-navigation.mjs PAGE_ID
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const page = process.argv[2];
assert.ok(page, 'Pass an existing Gling Orca page ID');
const credentials = JSON.parse(readFileSync(resolve(homedir(), 'Library/Application Support/gling/credentials/store-review.json')));
const orca = (...args) => {
  const result = JSON.parse(execFileSync('orca', [...args, '--page', page, '--json'], {
    cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }));
  assert.equal(result.ok, true, `Orca ${args[0]} failed`);
  return result.result;
};
const evaluate = (expression) => {
  const value = orca('eval', '--expression', expression).result;
  try { return JSON.parse(value); } catch { return value; }
};
const ref = (name, role) => {
  const entry = Object.entries(orca('snapshot').refs).find(([, item]) => item.name === name && (!role || item.role === role));
  assert.ok(entry, `Missing control: ${name}`);
  return entry[0];
};
const click = (name, role) => orca('click', '--element', ref(name, role));
const waitFor = async (expression) => {
  for (let i = 0; i < 40; i++) {
    if (evaluate(expression)) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  assert.fail(`Timed out: ${expression}`);
};
orca('goto', '--url', 'http://localhost:8091/profile');
await waitFor('document.body.innerText.length > 0');
// Remove only this synthetic review session; never disturb a personal login.
assert.equal(evaluate(`(() => {
  const key = 'sb-wjvahbdwmctzpkndqaxa-auth-token';
  const session = JSON.parse(localStorage.getItem(key) || 'null');
  if (session && session.user?.id !== ${JSON.stringify(credentials.userId)}) return false;
  localStorage.removeItem(key); return true;
})()`), true, 'This browser has a different user session');
orca('goto', '--url', 'http://localhost:8091/auth/review');
await waitFor('document.querySelector("input[type=password]") !== null');
orca('fill', '--element', ref('심사 계정 이메일 / Review email'), '--value', credentials.email);
orca('fill', '--element', ref('비밀번호 / Password'), '--value', `${credentials.password}-incorrect`);
click('심사 계정으로 로그인 / Sign in', 'button');
await waitFor('document.querySelector("[role=alert]") !== null');
assert.equal(evaluate('location.pathname'), '/auth/review');
assert.equal(evaluate('localStorage.getItem("sb-wjvahbdwmctzpkndqaxa-auth-token") === null'), true);
orca('fill', '--element', ref('비밀번호 / Password'), '--value', credentials.password);
click('심사 계정으로 로그인 / Sign in', 'button');
await waitFor('location.pathname === "/profile" && document.body.innerText.includes("글링심사")');
click('알림', 'button');
await waitFor('location.pathname === "/notifications"');
orca('back');
await waitFor('location.pathname === "/profile" && document.body.innerText.includes("글링심사")');
orca('goto', '--url', 'http://localhost:8091/auth/review');
await waitFor('location.pathname === "/profile" && document.body.innerText.includes("글링심사")');
console.log('PASS: wrong password rejected; review login, notifications return, session reload reach the profile.');
