import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function runtime(client, fetch) {
  let handle;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/safety-monitor/index.ts', import.meta.url), 'utf8') + '\nexports.analyze = analyze;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Request, Response, console, fetch, Deno: { serve(fn) { handle = fn; }, env: { get: () => 'offline' } }, require: () => ({ createClient: () => client }) });
  return { handle, ...exports };
}

test('retained versions reach the actual model input across normal bounded runs', async () => {
  const marker = 'retained-danger-marker';
  const segments = [...Array(7).fill('정'.repeat(2000)), marker, '정'.repeat(2000), '😀'.repeat(5000), 'remaining context'];
  let cursor = 0, calls = 0, risk = 'low', alerts = 0;
  const inputs = [];
  const client = { rpc: async (name, args) => {
    if (name === 'claim_safety_reviews_v2') {
      assert.equal(args.p_limit, 1);
      return { data: [{ id: 1, target_type: 'message', target_id: 'message', content_hash: 'hash', claimed_at: 'lease' }] };
    }
    if (name === 'get_message_safety_content') {
      assert.equal(args.p_queue_id, 1);
      assert.equal(args.p_content_hash, 'hash');
      assert.equal(args.p_claimed_at, 'lease');
      return { data: { authorId: 'author', text: segments[cursor], scan: { historyId: cursor + 1, offset: 0 } } };
    }
    if (name === 'complete_message_safety_review') {
      assert.equal(args.p_history_id, cursor + 1);
      const alert = args.p_risk_level === 'critical' && risk !== 'critical';
      if (alert) risk = 'critical';
      cursor += 1;
      return { data: { accepted: true, finished: cursor === segments.length, riskLevel: risk, alert } };
    }
    if (name === 'raise_safety_alert') { alerts += 1; return { error: null }; }
    assert.fail(`unexpected RPC: ${name}`);
  }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ai_safety_consent_at: 'yes' } }) }) }) }) };
  const worker = runtime(client, async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'gpt-5-mini');
    assert.equal(payload.store, false);
    const input = payload.input[0].content[0].text;
    inputs.push(input); calls += 1;
    const dangerous = input.includes(marker);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ riskScore: dangerous ? 1 : 0, riskLevel: dangerous ? 'critical' : 'low', reasons: [dangerous ? 'credible_threat' : 'none'] }) }] }] }) };
  });
  for (let n = 0; n < segments.length; n += 1) {
    const before = calls;
    const response = await worker.handle(new Request('https://offline.test', { method: 'POST', headers: { 'x-safety-secret': 'offline' }, body: '{"limit":1}' }));
    assert.equal(response.status, 200);
    assert.equal(calls - before, 1, 'one provider request per claimed queue item');
  }
  assert.equal(cursor, segments.length);
  assert.ok(inputs.some(input => input.includes(marker)), 'a late retained version is never silently truncated');
  assert.equal(risk, 'critical', 'later benign segments cannot lower prior risk');
  assert.equal(alerts, 1, 'high risk is raised before all remaining segments finish');
});

test('oversized input fails before a provider call instead of discarding its tail', async () => {
  let calls = 0;
  const worker = runtime({}, async () => { calls += 1; return { ok: true, json: async () => ({ output: [] }) }; });
  await assert.rejects(worker.analyze('offline', 'message', 'x'.repeat(14039) + 'retained-danger-marker'), /SAFETY_CONTENT_TOO_LONG/);
  assert.equal(calls, 0);
});
