import assert from 'node:assert/strict';
import test from 'node:test';
import { serveBusinessMedia } from '../supabase/functions/_shared/business-media.ts';

const id='a2000000-0000-4000-8000-000000000001', viewer='a2000000-0000-4000-8000-000000000002', version='a'.repeat(32);
const url=`https://example.test?format=business-image&id=${id}&kind=post&index=0&v=${version}`;
function setup(changes={}) {
  const calls=[];
  const client={
    auth:{getUser:async token=>{calls.push(['auth',token]);return {data:{user:{id:viewer}},error:null};}},
    rpc:async(name,args)=>{calls.push([name,args]);return {data:{bucket:'post-images',path:'PRIVATE_ACTOR/private.webp',version},error:null};},
    storage:{from:bucket=>({download:async path=>{calls.push(['download',bucket,path]);return {data:new Blob(['bytes'],{type:'image/webp'}),error:null};}})},
    ...changes,
  };
  return {client,calls};
}
test('public image response contains bytes and no storage URL or actor key',async()=>{
  const {client,calls}=setup(); const response=await serveBusinessMedia(new Request(url),client);
  assert.equal(response.status,200);assert.equal(await response.text(),'bytes');
  assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('Content-Type'),'image/webp');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.ok(!JSON.stringify([...response.headers]).includes('PRIVATE_ACTOR'));
  assert.deepEqual(calls[0],['get_business_public_media',{p_id:id,p_kind:'post',p_index:0,p_viewer:null}]);
});
test('invalid requests stop before any service lookup; preflight grants only needed headers',async()=>{
  for(const input of [url.replace('index=0','index=20'),url.replace('kind=post','kind=other'),url.replace(version,'bad'),url.replace(id,'bad')]) {
    const {client,calls}=setup();assert.equal((await serveBusinessMedia(new Request(input),client)).status,400);assert.deepEqual(calls,[]);
  }
  const {client,calls}=setup(); assert.equal((await serveBusinessMedia(new Request(url,{method:'POST'}),client)).status,405);
  const options=await serveBusinessMedia(new Request(url,{method:'OPTIONS'}),client);
  assert.equal(options.status,204);assert.equal(options.headers.get('Access-Control-Allow-Headers'),'Authorization');assert.deepEqual(calls,[]);
});
test('authenticated later images use the verified user, without returning the bearer token',async()=>{
  const {client,calls}=setup();const response=await serveBusinessMedia(new Request(url.replace('index=0','index=1'),{headers:{Authorization:'Bearer SESSION'}}),client);
  assert.equal(response.status,200);assert.equal(calls[1][1].p_viewer,viewer);assert.deepEqual(calls[0],['auth','SESSION']);
  assert.ok(!JSON.stringify([...response.headers]).includes('SESSION'));
  const denied=setup({auth:{getUser:async()=>({data:{user:null},error:{message:'PRIVATE'}})}});
  const invalid=await serveBusinessMedia(new Request(url,{headers:{Authorization:'Bearer INVALID'}}),denied.client);
  assert.equal(invalid.status,401);assert.equal(await invalid.text(),'');assert.deepEqual(denied.calls,[]);
});
test('revoked visibility, changed image versions and unexpected storage data fail closed',async()=>{
  for(const data of [null,{bucket:'post-images',path:'PRIVATE',version:'b'.repeat(32)},{bucket:'avatars',path:'PRIVATE',version},{bucket:'post-images',path:'../PRIVATE',version}]) {
    const {client,calls}=setup({rpc:async()=>({data,error:null})});const response=await serveBusinessMedia(new Request(url),client);
    assert.equal(response.status,404);assert.equal(await response.text(),'');assert.deepEqual(calls,[]);
  }
  for(const type of ['text/html','image/svg+xml']) {
    const {client}=setup({storage:{from:()=>({download:async()=>({data:new Blob(['PRIVATE'],{type}),error:null})})}});
    assert.equal((await serveBusinessMedia(new Request(url),client)).status,404);
  }
  const {client}=setup({rpc:async()=>{throw new Error('PRIVATE_ACTOR');}});
  const response=await serveBusinessMedia(new Request(url),client);assert.equal(response.status,503);assert.equal(await response.text(),'');
});
