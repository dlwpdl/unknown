import assert from 'node:assert/strict';
import test from 'node:test';
import { blockBusiness } from '../src/lib/community-data.ts';
import { businessMediaUrl } from '../src/lib/business-media.ts';
import { attachMerchantProfileImages } from '../src/lib/merchant-profile.ts';
import { getPostImageSource, hydratePublicPosts } from '../src/lib/feed-data.ts';
const postId='a2000000-0000-4000-8000-000000000001', businessId='a2100000-0000-4000-8000-000000000001';
const post={ id:postId, author:{ id:'actor', nickname:'개인 이웃', verified:false }, imagePaths:[] };
const row={post_id:postId,business_id:businessId,business_name:'지모코',private_contact:'PRIVATE'};
test('one bounded identity read adds company display while removing all personal attribution',async()=>{
 const calls=[];const client={rpc:async(...args)=>{calls.push(args);return {data:[row],error:null};}};
 const [result]=await hydratePublicPosts(client,[post]);
 assert.deepEqual(result.author,{id:businessId,nickname:'지모코',verified:false});assert.deepEqual(result.business,{id:businessId,name:'지모코',avatarUri:null});assert.ok(!JSON.stringify(result).includes('개인 이웃')); 
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

const version='a'.repeat(32);
test('opaque media accepts only bounded business references',()=>{
 const path=`business-post/${postId}/0/${version}`;
 assert.match(businessMediaUrl(path),new RegExp(`format=business-image&id=${postId}&kind=post&index=0&v=${version}$`));
 for(const bad of [path+'/extra',path.replace('/0/','/20/'),path.replace(version,'bad'),`business-profile/${businessId}/../${version}`,'https://evil.invalid/image']) assert.equal(businessMediaUrl(bad),null);
});
test('public post photos and logos never enter signed storage requests',async()=>{
 const image=`business-post/${postId}/0/${version}`,avatar=`business-profile/${businessId}/avatar/${version}`;
 const client={rpc:async()=>({data:[{...row,avatar_path:avatar}],error:null})};
 const [result]=await hydratePublicPosts(client,[{...post,imagePaths:[image]}]);
 assert.deepEqual(result.imageUris,[businessMediaUrl(image)]);assert.deepEqual(result.imageThumbs,result.imageUris);
 assert.equal(result.business.avatarUri,businessMediaUrl(avatar));
 const profile=await attachMerchantProfileImages(client,{avatar_path:avatar,banner_path:null});
 assert.equal(profile.avatarUri,businessMediaUrl(avatar));assert.equal(profile.imageLoadFailed,false);
 await assert.rejects(hydratePublicPosts({rpc:async()=>({data:[{...row,avatar_path:avatar.replace(businessId,postId)}],error:null})},[post]),/BUSINESS_IDENTITY_READ_FAILED/);
});

test('protected business gallery photos carry headers only for their current viewer',async()=>{
 const image=`business-post/${postId}/1/${version}`;
 const client={rpc:async()=>({data:[row],error:null}),auth:{getSession:async()=>({data:{session:{access_token:'SYNTHETIC',user:{id:'viewer'}}}})}};
 const [result]=await hydratePublicPosts(client,[{...post,imagePaths:[image]}]);
 assert.deepEqual(getPostImageSource(result,'viewer','full').headers,{Authorization:'Bearer SYNTHETIC'});
 assert.equal(getPostImageSource(result,'guest','full'),undefined);
 assert.ok(!JSON.stringify(result).includes('SYNTHETIC'));
});

test('business blocking uses its dedicated boundary without creating a personal block',async()=>{
 const calls=[];await blockBusiness({rpc:async(...args)=>{calls.push(args);return {error:null};}},'viewer',businessId);
 assert.deepEqual(calls,[['block_business',{p_business_id:businessId,p_user_id:'viewer'}]]);
 await assert.rejects(blockBusiness({rpc:async()=>({error:new Error('AUTH_CHANGED')})},'other',businessId),/AUTH_CHANGED/);
});
