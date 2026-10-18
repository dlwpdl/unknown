import assert from 'node:assert/strict';
import test from 'node:test';
import { hydratePublicPosts } from '../src/lib/feed-data.ts';
const postId='a2000000-0000-4000-8000-000000000001', businessId='a2100000-0000-4000-8000-000000000001';
const post={ id:postId, author:{ id:'actor', nickname:'개인 이웃', verified:false }, imagePaths:[] };
const row={post_id:postId,business_id:businessId,business_name:'지모코',private_contact:'PRIVATE'};
test('one bounded identity read adds company display while retaining the personal actor',async()=>{
 const calls=[];const client={rpc:async(...args)=>{calls.push(args);return {data:[row],error:null};}};
 const [result]=await hydratePublicPosts(client,[post]);
 assert.equal(result.author,post.author);assert.deepEqual(result.business,{id:businessId,name:'지모코'});
 assert.deepEqual(calls,[['get_public_post_businesses',{p_post_ids:[postId]}]]);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('missing rollout RPC keeps legacy posts; malformed, foreign and denied reads fail closed',async()=>{
 const legacy=await hydratePublicPosts({rpc:async()=>({error:{code:'PGRST202'}})},[post]);assert.equal(legacy[0].business,undefined);
 for(const data of [[{...row,post_id:'other'}],[row,row],[{...row,business_id:'bad'}],{}]) await assert.rejects(hydratePublicPosts({rpc:async()=>({data,error:null})},[post]),/BUSINESS_IDENTITY_READ_FAILED/);
 await assert.rejects(hydratePublicPosts({rpc:async()=>({error:{code:'42501',message:'denied'}})},[post]));
});
test('empty pages have no extra request and oversized pages cannot bypass the bound',async()=>{
 let calls=0;const client={rpc:async()=>{calls++;return {data:[],error:null};}};
 assert.deepEqual(await hydratePublicPosts(client,[]),[]);assert.equal(calls,0);
 await assert.rejects(hydratePublicPosts(client,Array.from({length:51},()=>post)),/BUSINESS_IDENTITY_READ_FAILED/);assert.equal(calls,0);
});
