import assert from 'node:assert/strict';
import test from 'node:test';
import { merchantMcpTools, validateMerchantMcpCall, validateMerchantMcpClaims, merchantMcpResponse } from '../supabase/functions/_shared/merchant-mcp.ts';

const merchant='14010000-0000-4000-8000-000000000001', draft='14020000-0000-4000-8000-000000000001';
const resource='https://example.supabase.co/functions/v1/merchant-mcp';
const claims={sub:'mcp:14040000-0000-4000-8000-000000000001',gling_actor_id:'14000000-0000-4000-8000-000000000001',session_id:'14070000-0000-4000-8000-000000000001',scope:'offline_access',client_id:'14030000-0000-4000-8000-000000000001',gling_connection_id:'14040000-0000-4000-8000-000000000001',iss:'https://example.supabase.co/auth/v1',aud:resource,role:'gling_mcp',exp:2000,iat:900};

test('customer tools expose only Gling owner content and cannot approve, administer or operate the app',()=>{
  const tools=merchantMcpTools({allow_drafts:true,allow_publish:true});
  assert.deepEqual(tools.map(t=>t.name),['list_my_businesses','get_business_profile','list_business_posts','get_business_post','list_business_drafts','save_business_draft','preview_business_draft','publish_business_draft','propose_business_change','get_business_change']);
  assert.ok(tools.every(t=>t.inputSchema.additionalProperties===false));
  assert.deepEqual(merchantMcpTools({allow_drafts:false,allow_publish:false}).map(t=>t.name),['list_my_businesses','get_business_profile','list_business_posts','get_business_post','list_business_drafts','preview_business_draft','get_business_change']);
});
test('unknown arguments, unbounded pages, unreviewed publishing and malformed media fail at the boundary',()=>{
  assert.deepEqual(validateMerchantMcpCall('list_business_posts',{merchant_id:merchant,offset:0}),{merchant_id:merchant,offset:0});
  for(const [name,args] of [
    ['list_merchants',{}],['get_business_profile',{merchant_id:merchant,user_id:claims.sub}],
    ['list_business_posts',{merchant_id:merchant,offset:-1}],['list_business_posts',{merchant_id:merchant,offset:10001}],
    ['publish_business_draft',{merchant_id:merchant,draft_id:draft}],
    ['save_business_draft',{merchant_id:merchant,draft_id:draft,title:'안내',body:'본문',image_paths:['https://example.com/a.jpg']}],
    ['propose_business_change',{merchant_id:merchant,request_id:draft,kind:'profile',expected_revision:'2026-10-09T00:00:00Z',changes:{owner_id:claims.sub}}],
  ]) assert.throws(()=>validateMerchantMcpCall(name,args),/INVALID_MCP_INPUT|MCP_TOOL_NOT_ALLOWED/);
});
test('only signed claims for this MCP resource can proceed; ordinary app tokens and expired or replaced links fail',()=>{
  assert.equal(validateMerchantMcpClaims(claims,resource,1000).connectionId,claims.gling_connection_id);
  for(const patch of [{role:'authenticated'},{aud:'authenticated'},{iss:'https://other.supabase.co/auth/v1'},{exp:999},{iat:2000},{client_id:null},{gling_connection_id:null},{gling_actor_id:null},{scope:'openid'},{session_id:null},{sub:'admin'}]) {
    assert.throws(()=>validateMerchantMcpClaims({...claims,...patch},resource,1000),/AUTH_REQUIRED/);
  }
});
test('MCP dispatch accepts initialization and notifications, bounds tool inputs and returns errors without server details',async()=>{
  const calls=[];
  const execute=async(name,args)=>{calls.push([name,args]);return {merchant_id:merchant};};
  const access={allow_drafts:true,allow_publish:false};
  const initialized=await merchantMcpResponse({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}},access,execute);
  assert.equal(initialized.result.protocolVersion,'2025-11-25');
  assert.equal(await merchantMcpResponse({jsonrpc:'2.0',method:'notifications/initialized'},access,execute),null);
  const result=await merchantMcpResponse({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_business_profile',arguments:{merchant_id:merchant}}},access,execute);
  assert.deepEqual(result.result.structuredContent,{merchant_id:merchant});
  const denied=await merchantMcpResponse({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'publish_business_draft',arguments:{merchant_id:merchant,draft_id:draft,expected_updated_at:'2026-10-09T00:00:00Z'}}},access,execute);
  assert.equal(denied.result.isError,true);assert.equal(calls.length,1);
  const failed=await merchantMcpResponse({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'get_business_profile',arguments:{merchant_id:merchant}}},access,async()=>{throw new Error('secret database detail');});
  assert.equal(failed.result.isError,true);assert.doesNotMatch(JSON.stringify(failed),/secret database detail/);
});
