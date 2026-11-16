import assert from 'node:assert/strict';
import test from 'node:test';
import { merchantMcpTools, validateMerchantMcpCall, merchantMcpResponse, personalMcpTool, signPersonalPhotoUploads } from '../supabase/functions/_shared/merchant-mcp.ts';
import { handleMerchantMcpRequest } from '../supabase/functions/_shared/merchant-mcp-http.ts';

const actor='14000000-0000-4000-8000-000000000001', other='14000000-0000-4000-8000-000000000002', draft='14020000-0000-4000-8000-000000000001';
const photo=(n=1,ext='jpg',owner=actor)=>`${owner}/1762990000000-0123456789ab-${n}.${ext}`;
const names=access=>merchantMcpTools(access).map(tool=>tool.name);
const personal=['list_post_boards','list_my_posts','create_photo_uploads','save_personal_draft','preview_personal_draft'];

test('personal tools appear only for a personal grant, publishing only at the publish level, and hide business tools for personal-only links',()=>{
  assert.deepEqual(names({allow_drafts:false,allow_publish:false,business:false,personal_posts:'drafts'}),personal);
  assert.deepEqual(names({allow_drafts:false,allow_publish:false,business:false,personal_posts:'publish'}),[...personal,'publish_personal_draft']);
  assert.ok(!names({allow_drafts:true,allow_publish:true}).some(personalMcpTool));
  assert.ok(!names({allow_drafts:true,allow_publish:true,personal_posts:null}).some(personalMcpTool));
  assert.equal(names({allow_drafts:true,allow_publish:false,personal_posts:'drafts'}).length,9+personal.length);
  assert.ok(personalMcpTool('publish_personal_draft')&&!personalMcpTool('publish_business_draft')&&!personalMcpTool('_context'));
});
test('personal inputs are bounded: photo count and type, own upload path shape, listing price and no extra keys',()=>{
  assert.deepEqual(validateMerchantMcpCall('create_photo_uploads',{count:10,content_type:'image/jpeg'}),{count:10,content_type:'image/jpeg'});
  const input={draft_id:draft,city_id:'vancouver',board:'used',title:'의자 팝니다',body:'거의 새것',image_paths:[photo(1),photo(2,'png')],price:12.5};
  assert.deepEqual(validateMerchantMcpCall('save_personal_draft',input),input);
  assert.ok(validateMerchantMcpCall('save_personal_draft',{...input,price:null}));
  for(const [name,args] of [
    ['create_photo_uploads',{count:0,content_type:'image/jpeg'}],['create_photo_uploads',{count:11,content_type:'image/jpeg'}],
    ['create_photo_uploads',{count:1.5,content_type:'image/jpeg'}],['create_photo_uploads',{count:1,content_type:'image/gif'}],
    ['create_photo_uploads',{count:1,content_type:'image/jpeg',url:'https://example.com/a.jpg'}],
    ['save_personal_draft',{...input,image_paths:['owner/a.webp']}],['save_personal_draft',{...input,image_paths:[`../${photo()}`]}],
    ['save_personal_draft',{...input,image_paths:[photo(),photo()]}],['save_personal_draft',{...input,price:-1}],
    ['save_personal_draft',{...input,price:'12'}],['save_personal_draft',{...input,price:Number.NaN}],['save_personal_draft',{...input,author_id:other}],
    ['save_personal_draft',{...input,title:'가'.repeat(81)}],['publish_personal_draft',{draft_id:draft}],
  ]) assert.throws(()=>validateMerchantMcpCall(name,args),/INVALID_MCP_INPUT/,`${name} ${JSON.stringify(args)}`);
});
test('a drafts-only grant cannot call publish even if the client asks, and the database decides every allowed call',async()=>{
  const calls=[];const run=async(name,args)=>{calls.push(name);return {ok:true};};
  const access={allow_drafts:false,allow_publish:false,business:false,personal_posts:'drafts'};
  const call=(name,args)=>merchantMcpResponse({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},access,run);
  assert.equal((await call('publish_personal_draft',{draft_id:draft,expected_updated_at:'2026-11-13T00:00:00Z'})).result.content[0].text,'MCP_TOOL_NOT_ALLOWED');
  assert.equal((await call('list_my_businesses',{})).result.content[0].text,'MCP_TOOL_NOT_ALLOWED');
  assert.deepEqual((await call('list_post_boards',{})).result.structuredContent,{ok:true});assert.deepEqual(calls,['list_post_boards']);
  const init=await merchantMcpResponse({jsonrpc:'2.0',id:2,method:'initialize',params:{}},access,run);
  assert.match(init.result.instructions,/개인 계정/);assert.doesNotMatch(init.result.instructions,/사업자/);
});
test('upload links are signed only for this member folder and come back with a ready curl line',async()=>{
  const signed=[];const sign=async path=>{signed.push(path);return {data:{signedUrl:`https://storage.example/upload/sign/post-images/${path}?token=t`},error:null};};
  const data={uploads:[{path:photo(1),content_type:'image/jpeg'},{path:photo(2),content_type:'image/jpeg'}],expires_at:'2026-11-13T00:10:00Z',max_bytes:2097152};
  const result=await signPersonalPhotoUploads(data,actor,sign);
  assert.deepEqual(signed,[photo(1),photo(2)]);assert.equal(result.expires_at,data.expires_at);assert.equal(result.max_bytes,2097152);
  assert.equal(result.uploads[1].curl,`curl -X PUT -H "Content-Type: image/jpeg" --data-binary @photo-2.jpg "${result.uploads[1].upload_url}"`);
  for(const bad of [{uploads:[{path:photo(1,'jpg',other),content_type:'image/jpeg'}]},{uploads:[{path:`${actor}/x.jpg`,content_type:'image/jpeg'}]},
    {uploads:[{path:photo(),content_type:'text/html'}]},{uploads:[]},{uploads:Array.from({length:11},(_,i)=>({path:photo(i%10),content_type:'image/jpeg'}))},null])
    await assert.rejects(signPersonalPhotoUploads(bad,actor,sign),/PHOTO_UPLOAD_FAILED/);
  await assert.rejects(signPersonalPhotoUploads(data,actor,async()=>({data:null,error:new Error('denied')})),/PHOTO_UPLOAD_FAILED/);
});
test('the HTTP boundary passes the live personal level and a personal-only flag from the database context',async()=>{
  const resource='https://example.supabase.co/functions/v1/merchant-mcp';
  const now=Math.floor(Date.now()/1000);
  const claims={sub:'mcp:14040000-0000-4000-8000-000000000001',gling_actor_id:actor,session_id:'14070000-0000-4000-8000-000000000001',scope:'offline_access',client_id:'14030000-0000-4000-8000-000000000001',gling_connection_id:'14040000-0000-4000-8000-000000000001',iss:'https://example.supabase.co/auth/v1',aud:resource,role:'gling_mcp',exp:now+3600,iat:now};
  const list=async context=>{
    const response=await handleMerchantMcpRequest(new Request(resource,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer t'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),{resource,allowedOrigins:[]},async()=>claims,async()=>context);
    return (await response.json()).result.tools.map(tool=>tool.name);
  };
  assert.deepEqual(await list({allow_drafts:false,allow_publish:false,business:false,personal_posts:'publish'}),[...personal,'publish_personal_draft']);
  assert.deepEqual(await list({allow_drafts:false,allow_publish:false,business:false,personal_posts:'anything'}),[]);
  assert.equal((await list({allow_drafts:true,allow_publish:false,personal_posts:null})).length,9);
});
