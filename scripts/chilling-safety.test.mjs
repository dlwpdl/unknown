import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
let analyzedPayload;
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/safety-monitor/index.ts', import.meta.url), 'utf8') + '\nexports.loadContent = loadContent;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports, Deno: { serve() {} }, require: () => ({}) });
const { loadContent } = exports;

test('analysis preserves question and cadence after a maximum-length Unicode post', async () => {
  const worker = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/safety-monitor/index.ts', import.meta.url), 'utf8') + '\nexports.analyze = analyze;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: worker, Deno: { serve() {} }, require: () => ({}), fetch: async (_url, options) => {
    analyzedPayload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '{"riskScore":0,"riskLevel":"low","reasons":["none"]}' }] }] }) };
  } });
  const question = '질'.repeat(299) + '?';
  const cadence = '일'.repeat(80);
  const record = { author_id: 'host', title: '😀'.repeat(80), body: '😀'.repeat(5000), hashtags: Array(5).fill('😀'.repeat(30)), room_preview: { applicationQuestion: question, cadence } };
  const content = await loadContent({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: record }) }) }) }) }, 'post', 'id');
  await worker.analyze('offline-test', 'post', content.text);
  const prompt = analyzedPayload.input[0].content[0].text;
  assert.ok(prompt.includes(question), 'complete application question reaches the model');
  assert.ok(prompt.includes(cadence), 'complete cadence reaches the model');
  assert.equal(analyzedPayload.store, false);
  await worker.analyze('offline-test', 'post', 'x'.repeat(30000));
  assert.ok(analyzedPayload.input[0].content[0].text.length < 14000, 'oversized input remains bounded');
});

test('Chilling content uses the service RPC and propagates missing content and errors', async () => {
  for (const targetType of ['chilling_profile', 'chilling_application']) {
    const client = { rpc: async (name, args) => {
      assert.equal(name, 'get_chilling_safety_content');
      assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_target_type: targetType, p_target_id: 'content-id' });
      return { data: { authorId: 'author-id', text: '소개와 지원 답변' }, error: null };
    } };
    assert.equal((await loadContent(client, targetType, 'content-id')).text, '소개와 지원 답변');
    assert.equal(await loadContent({ rpc: async () => ({ data: null }) }, targetType, 'missing'), null);
    await assert.rejects(loadContent({ rpc: async () => ({ error: new Error('denied') }) }, targetType, 'private'), /denied/);
  }
});

test('unknown safety targets cannot fall through to private messages', async () => {
  await assert.rejects(loadContent({}, 'unknown', 'id'), /UNSUPPORTED_TARGET_TYPE/);
});

test('post safety content includes the meeting question and cadence alongside existing fields', async () => {
  const client = { from: table => {
    assert.equal(table, 'posts');
    return { select: columns => {
      assert.ok(columns.split(',').includes('room_preview'));
      return { eq: () => ({ maybeSingle: async () => ({ data: {
        author_id: 'host', title: '산책', body: '같이 걸어요', hashtags: ['친구'],
        room_preview: { applicationQuestion: '어떤 산책을 좋아하세요?', cadence: '매주 토요일' },
      } }) }) };
    } };
  } };
  const result = await loadContent(client, 'post', 'id');
  assert.equal(result.authorId, 'host');
  assert.equal(result.text, '산책\n같이 걸어요\n친구\n어떤 산책을 좋아하세요?\n매주 토요일');
});

test('admin content reads use the audited RPC and propagate access denial', async () => {
  const admin = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/admin-data.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: admin, require: () => ({}) });
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'get_admin_chilling_content');
    assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_target_type: 'chilling_application', p_target_id: 'private-id' });
    return { data: { authorId: 'applicant', text: '신청 답변' } };
  } };
  assert.equal((await admin.loadAdminChillingContent(client, 'chilling_application', 'private-id')).text, '신청 답변');
  await assert.rejects(admin.loadAdminChillingContent({ rpc: async () => ({ error: new Error('ADMIN_REQUIRED') }) }, 'chilling_profile', 'private-id'), /ADMIN_REQUIRED/);
});
