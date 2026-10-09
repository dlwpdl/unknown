import assert from 'node:assert/strict';
import test from 'node:test';
import { connectMerchantMcp, denyMerchantMcp, loadMerchantMcpChangePhotos, merchantMcpReturnPath, rememberMerchantMcpReturn, safeMerchantMcpRedirect, reviewMerchantMcpChange } from '../src/lib/merchant-mcp.ts';

const user='14000000-0000-4000-8000-000000000001',clientId='14030000-0000-4000-8000-000000000001',merchant='14010000-0000-4000-8000-000000000001';
const authorization={authorization_id:'native-request-123',client_id:clientId,client_name:'나의 AI 도구',redirect_uri:'http://127.0.0.1:5500/callback',scope:'offline_access',expires_at:'2099-01-01T00:00:00Z'};
const grant={merchantIds:[merchant],allowDrafts:true,allowPublish:false};
function mockClient({redirect=false,otherUser=false,approveFails=false,switchAt=''}={}) {
  const calls=[];
  let switched=otherUser;
  return {calls,auth:{getSession:async()=>({data:{session:{user:{id:switched?'other-account':user}}}}),oauth:{
    getAuthorizationDetails:async(id)=>{calls.push(['details',id]);if(switchAt==='details')switched=true;return {data:redirect?{redirect_url:'http://127.0.0.1:5500/callback?code=local-test&state=original'}:{authorization_id:id,client:{id:clientId},user:{id:user},scope:'offline_access',redirect_uri:authorization.redirect_uri},error:null};},
    approveAuthorization:async(id,options)=>{calls.push(['approve',id,options]);if(switchAt==='approve')switched=true;return approveFails?{error:{message:'unavailable'}}:{data:{redirect_url:'http://127.0.0.1:5500/callback?code=local-test&state=original'},error:null};},
  }},rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='get_merchant_mcp_authorization'?authorization:name==='save_merchant_mcp_connection'?{id:'new-connection'}:name==='review_merchant_mcp_change'?{id:args.p_request_id,status:'applied'}:true,error:null};}};
}
test('consent saves an explicit grant before native approval and disables automatic browser redirects',async()=>{
  const client=mockClient();
  assert.match(await connectMerchantMcp(client,user,authorization,grant),/^http:\/\/127\.0\.0\.1:5500\/callback\?/);
  assert.deepEqual(client.calls.map(c=>c[0]),['save_merchant_mcp_connection','details','get_merchant_mcp_authorization','approve']);
  assert.deepEqual(client.calls[0][1],{p_expected_actor_id:user,p_client_id:clientId,p_merchant_ids:[merchant],p_allow_drafts:true,p_allow_publish:false});
  assert.equal(client.calls[3][2].skipBrowserRedirect,true);
});
test('already-consented OAuth redirects still require a newly reviewed business grant; failed approval rolls it back by revocation',async()=>{
  const client=mockClient({redirect:true});await connectMerchantMcp(client,user,authorization,grant);
  assert.deepEqual(client.calls.map(c=>c[0]),['save_merchant_mcp_connection','details','get_merchant_mcp_authorization']);
  const failed=mockClient({approveFails:true});await assert.rejects(connectMerchantMcp(failed,user,authorization,grant),/MCP_CONNECT_FAILED/);
  assert.equal(failed.calls.at(-1)[0],'revoke_merchant_mcp_connection');
});
test('an account switch during auto-approval or final approval never forwards another account code',async()=>{
  for(const [redirect,switchAt] of [[true,'details'],[false,'approve']]) {
    const client=mockClient({redirect,switchAt});
    await assert.rejects(connectMerchantMcp(client,user,authorization,grant),/ACCOUNT_CHANGED/);
    assert.equal(client.calls.at(-1)[0],'revoke_merchant_mcp_connection');
  }
});
test('scope, account switches and callback substitution cannot silently approve a different request',async()=>{
  const client=mockClient();
  await assert.rejects(connectMerchantMcp(client,user,{...authorization,scope:'openid email'},grant),/MCP_SCOPE_NOT_ALLOWED/);assert.equal(client.calls.length,0);
  const changed=mockClient({otherUser:true});await assert.rejects(reviewMerchantMcpChange(changed,user,'request-id',true),/ACCOUNT_CHANGED/);assert.equal(changed.calls.length,0);
  assert.equal(safeMerchantMcpRedirect('https://ai.example/callback?code=a','https://ai.example/callback'),'https://ai.example/callback?code=a');
  for(const next of ['https://evil.example/callback?code=a','javascript:alert(1)','http://192.168.1.2/callback?code=a','http://127.0.0.1:5500/other?code=a']) assert.throws(()=>safeMerchantMcpRedirect(next,authorization.redirect_uri),/MCP_REDIRECT_INVALID/);
});
test('social login return stores only a bounded authorization ID and cannot supply an arbitrary redirect',()=>{
  const data=new Map(),storage={setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k)};
  rememberMerchantMcpReturn(storage,'native-request-123',1000);
  assert.equal(merchantMcpReturnPath(storage,2000),'/ai?authorization_id=native-request-123');assert.equal(data.size,0);
  rememberMerchantMcpReturn(storage,'native-request-123',1000);assert.equal(merchantMcpReturnPath(storage,602000),'/');
  assert.throws(()=>rememberMerchantMcpReturn(storage,'https://evil.example',1000),/INVALID_MCP_INPUT/);
});
test('cancel never forwards a code even when the native OAuth provider auto-approves an existing consent',async()=>{
  const client=mockClient({redirect:true});const url=new URL(await denyMerchantMcp(client,user,authorization));
  assert.equal(url.searchParams.get('error'),'access_denied');assert.equal(url.searchParams.get('state'),'original');assert.equal(url.searchParams.has('code'),false);
  assert.deepEqual(client.calls.map(c=>c[0]),['details']);
});
test('public change review signs current, proposed and deletion photos without hiding a failed preview',async()=>{
  const calls=[], client={storage:{from:bucket=>({createSignedUrls:async paths=>{calls.push([bucket,paths]);return {data:paths.map(path=>({path,signedUrl:`https://photos.example/${path}`})),error:null};}})}};
  const edit={kind:'edit_post',before_value:{image_paths:['old.jpg']},changes:{image_paths:['new.jpg']}};
  assert.deepEqual(await loadMerchantMcpChangePhotos(client,edit),[{label:'현재 사진',uris:['https://photos.example/old.jpg']},{label:'제안한 사진',uris:['https://photos.example/new.jpg']}]);
  assert.equal(calls[0][0],'post-images');
  assert.deepEqual(await loadMerchantMcpChangePhotos(client,{...edit,kind:'delete_post',changes:{}}),[{label:'삭제할 글의 사진',uris:['https://photos.example/old.jpg']}]);
  assert.deepEqual(await loadMerchantMcpChangePhotos(client,{kind:'profile',before_value:{avatar_path:'old-avatar.jpg'},changes:{avatar_path:null}}),[{label:'현재 프로필 사진',uris:['https://photos.example/old-avatar.jpg']},{label:'제안한 프로필 사진',uris:[]}]);
  assert.equal(calls.at(-1)[0],'merchant-profile-images');
  const missing={storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null})})}};
  await assert.rejects(loadMerchantMcpChangePhotos(missing,edit),/MCP_PHOTO_PREVIEW_FAILED/);
  assert.deepEqual(await loadMerchantMcpChangePhotos(missing,{kind:'profile',before_value:{},changes:{name:'커피 가게'}}),[]);
});
