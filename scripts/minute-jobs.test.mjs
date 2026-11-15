import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
const lastDefining = (name) => files.findLast((file) => new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+${name.replace('.', '\\.')}\\s*\\(`, 'i')
  .test(readFileSync(new URL(file, dir), 'utf8')));

// The minute job wakes the push and safety functions only when these claims would find work,
// so a claim change must ship together with (or before) a matching wake-condition change.
test('push and safety wake conditions are redefined whenever their claim functions change', () => {
  for (const [claims, wake] of [
    [['public.claim_push_notifications'], 'private.push_work_due'],
    [['public.claim_safety_reviews', 'public.claim_safety_reviews_v2'], 'private.safety_work_due'],
  ]) {
    const wakeFile = lastDefining(wake);
    assert.ok(wakeFile, `${wake} is defined`);
    for (const claim of claims) assert.ok(lastDefining(claim) <= wakeFile, `${claim} changed after ${wake}; update ${wake} in the same migration`);
  }
});
