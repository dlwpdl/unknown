import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdminMerchantAccess, setAdminMerchantAccess } from '../src/lib/admin-merchants.ts';
import { calculateMerchantCost, merchantPlan, merchantDraftCopy, saveMerchantDraft, saveMerchantItem, approveMerchantDrafts, publishMerchantDraft, recordMerchantExternalPost, getMyMerchantAccess } from '../src/lib/merchant-workspace.ts';

test('batch ingredients, packaging and fees produce contribution rather than claimed net profit', () => {
  const result = calculateMerchantCost({ batchCost: 40, yield: 10, packaging: 1, other: .5, price: 12, feePercent: 3 });
  assert.equal(result.unitCost, 5.86);
  assert.equal(result.contribution, 6.14);
  assert.equal(result.marginPercent, 6.14 / 12 * 100);
  assert.equal(result.costPercent, 5.86 / 12 * 100);
});
test('zero price keeps unit cost meaningful without inventing rates', () => {
  assert.deepEqual(calculateMerchantCost({ batchCost: 20, yield: 5, packaging: 0, other: 0, price: 0, feePercent: 0 }), { unitCost: 4, contribution: -4, marginPercent: null, costPercent: null });
});
test('invalid money, yield and fee inputs fail explicitly', () => {
  const input = { batchCost: 20, yield: 5, packaging: 0, other: 0, price: 10, feePercent: 0 };
  for (const bad of [{ batchCost: -1 }, { yield: 0 }, { yield: Number.MIN_VALUE }, { feePercent: 100 }, { other: NaN }, { price: Infinity }, { price: Number.MIN_VALUE }, { packaging: -1 }]) {
    assert.throws(() => calculateMerchantCost({ ...input, ...bad }), /INVALID_COST_INPUT/);
  }
});
test('business trial uses server city date and cannot grant personal premium', () => {
  assert.equal(merchantPlan({ status: 'trial', trial_ends_at: '2026-10-07' }, '2026-10-07'), 'trial');
  assert.equal(merchantPlan({ status: 'trial', trial_ends_at: '2026-10-07' }, '2026-10-08'), 'basic');
  assert.equal(merchantPlan({ status: 'trial', trial_ends_at: null }, '2026-10-07'), 'basic');
  assert.equal(merchantPlan({ status: 'paused', trial_ends_at: '2027-01-01' }, '2026-10-07'), 'basic');
  assert.equal(merchantPlan({ status: 'paid', trial_ends_at: null, workspace_until: '2026-11-07' }, '2026-10-07'), 'pro');
  assert.equal(merchantPlan({ status: 'paid', trial_ends_at: null, workspace_until: '2026-10-06' }, '2026-10-07'), 'basic');
  assert.equal(merchantPlan({ status: 'paid', trial_ends_at: null }, '2026-10-07'), 'basic');
});
test('copy uses only actual draft text and optional source, not invented offers or testimonials', () => {
  assert.equal(merchantDraftCopy({ title: '신메뉴 안내', body: '판매가 12달러', original_url: null }), '신메뉴 안내\n\n판매가 12달러');
  assert.equal(merchantDraftCopy({ title: '안내', body: '실제 본문', original_url: 'https://example.com' }), '안내\n\n실제 본문\n\nhttps://example.com');
});
test('editing server rows sends only the RPC writable fields', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: args.p_id ?? args.p_draft_id ?? { approved: 1 }, error: null }; } };
  const item = { id: 'item', name: '재료', unit: '개', unit_cost: 2, low_stock: 3, quantity: 10, updated_at: '2026-10-07T22:00:00Z' };
  const draft = { id: 'draft', channel: 'gling', title: '안내', body: '실제 본문', original_url: null, tag_slug: 'life', kind: 'story', approved_at: '2026-10-07T22:00:00Z', post_id: 'post', published_at: '2026-10-07T22:00:00Z', external_url: null, archived_at: null, updated_at: '2026-10-07T22:00:00Z' };
  await saveMerchantItem(client, 'merchant', item);
  await saveMerchantDraft(client, 'merchant', draft);
  assert.deepEqual(calls, [
    { name: 'save_merchant_workspace_item', args: { p_merchant_id: 'merchant', p_id: 'item', p_name: '재료', p_unit: '개', p_unit_cost: 2, p_low_stock: 3 } },
    { name: 'save_merchant_workspace_draft', args: { p_merchant_id: 'merchant', p_id: 'draft', p_channel: 'gling', p_title: '안내', p_body: '실제 본문', p_original_url: null, p_tag_slug: 'life', p_kind: 'story' } },
  ]);
  assert.equal(item.quantity, 10);
  assert.equal(draft.post_id, 'post');
  calls.length = 0;
  await approveMerchantDrafts(client, 'merchant', ['draft'], true, { draft: draft.updated_at });
  await publishMerchantDraft(client, 'merchant', 'draft', draft.updated_at);
  await recordMerchantExternalPost(client, 'merchant', 'draft', 'https://cafe.naver.com/example/1', draft.updated_at);
  assert.deepEqual(calls.map(call => call.args.p_expected_updated_at), [{ draft: draft.updated_at }, draft.updated_at, draft.updated_at]);
});


test('merchant capability reads actual server booleans and never treats malformed data as YES', async () => {
  for (const data of [false, true]) {
    assert.equal(await getMyMerchantAccess({ rpc: async () => ({ data, error: null }) }), data);
  }
  for (const data of [null, 'true', {}, 1]) await assert.rejects(getMyMerchantAccess({ rpc: async () => ({ data, error: null }) }), /MERCHANT_ACCESS_READ_FAILED/);
  await assert.rejects(getMyMerchantAccess({ rpc: async () => ({ data: true, error: { message: 'AUTH_REQUIRED' } }) }), /AUTH_REQUIRED/);
});
test('admin YES NO writes explicit capability and verifies same server value', async () => {
  const calls=[]; const client={rpc: async (name,args)=>{ calls.push([name,args]); return { data:false,error:null }; }};
  assert.equal(await getAdminMerchantAccess(client,'member'),false);
  assert.equal(await setAdminMerchantAccess(client,'member',false),false);
  assert.deepEqual(calls,[['get_admin_merchant_access',{p_user_id:'member'}],['set_admin_merchant_access',{p_user_id:'member',p_enabled:false}]]);
  await assert.rejects(setAdminMerchantAccess({rpc:async()=>({data:false,error:null})},'member',true),/MERCHANT_ACCESS_SAVE_FAILED/);
});
