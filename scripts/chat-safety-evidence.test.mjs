import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function runtime(client, fetch) {
  let handle;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/safety-monitor/index.ts', import.meta.url), 'utf8') + '\nexports.analyze = analyze; exports.loadContent = loadContent;', {
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

test('a failed message completion and failure RPC cannot stop the following post', async () => {
  let modelCalls = 0, postReads = 0, messageCompletions = 0;
  const client = { rpc: async name => {
    if (name === 'claim_safety_reviews_v2') return { data: [
      { id: 1, target_type: 'message', target_id: 'message', content_hash: 'hash', claimed_at: 'lease' },
      { id: 2, target_type: 'post', target_id: 'post' },
    ] };
    if (name === 'get_message_safety_content') return { data: { authorId: 'author', text: 'message', scan: { historyId: 1, offset: 0 } } };
    if (name === 'complete_message_safety_review') { messageCompletions += 1; return { error: new Error('COMPLETION_UNAVAILABLE') }; }
    if (name === 'complete_safety_review') return { error: null };
    assert.fail(name);
  }, from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    if (table === 'profiles') return { data: { ai_safety_consent_at: 'yes' } };
    assert.equal(table, 'posts'); postReads += 1;
    return { data: { author_id: 'author', title: 'post', body: 'body', hashtags: [] } };
  } }) }) }) };
  const worker = runtime(client, async () => {
    modelCalls += 1;
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '{"riskScore":0,"riskLevel":"low","reasons":["none"]}' }] }] }) };
  });
  const response = await worker.handle(new Request('https://offline.test', { method: 'POST', headers: { 'x-safety-secret': 'offline' }, body: '{"limit":2}' }));
  assert.equal(response.status, 200);
  assert.equal(modelCalls, 2);
  assert.equal(postReads, 1);
  assert.equal(messageCompletions, 2);
  const result = await response.json();
  assert.equal(result.failed, 1);
  assert.equal(result.reviewed, 1);
});


test('poll question and every option reach post safety analysis', async () => {
  const worker = runtime({}, () => {});
  const content = await worker.loadContent({ from: table => ({ select: columns => ({ eq: () => ({ maybeSingle: async () => {
    assert.equal(table, 'posts');
    assert.match(columns, /post_polls\(question,options\)/);
    return { data: { author_id: 'author', title: 'post', body: 'body', hashtags: [],
      post_polls: { question: 'poll-danger-marker', options: ['first', 'option-danger-marker'] } } };
  } }) }) }) }, 'post', 'post');
  assert.match(content.text, /poll-danger-marker/);
  assert.match(content.text, /option-danger-marker/);
});


test('maximum Unicode poll content fits the existing bounded model input', async () => {
  let calls = 0;
  const worker = runtime({}, async () => {
    calls += 1;
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '{"riskScore":0,"riskLevel":"low","reasons":["none"]}' }] }] }) };
  });
  const record = { author_id: 'author', title: '😀'.repeat(80), body: '😀'.repeat(5000),
    hashtags: Array(5).fill('😀'.repeat(30)), post_polls: { question: '😀'.repeat(120), options: Array(6).fill('😀'.repeat(80)) } };
  const content = await worker.loadContent({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: record }) }) }) }) }, 'post', 'post');
  await worker.analyze('offline', 'post', content.text);
  assert.equal(calls, 1);
});
