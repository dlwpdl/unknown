import assert from 'node:assert/strict';
import test from 'node:test';
import * as data from '../src/lib/chilling-data.ts';

const profile = { intro: ' 함께 걸어요 ', interests: [' 산책 ', '커피'], promptOne: '느긋하게', promptTwo: '편한 사람들' };
test('profile save validates bounds and sends only normalized sharing fields', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name,args]); return {error:null}; } };
  await data.saveChillingProfile(client, {...profile, ownerId:'forged'});
  assert.deepEqual(calls, [['save_chilling_profile', {p_profile:{...profile,intro:'함께 걸어요',interests:['산책','커피']}}]]);
  await assert.rejects(data.saveChillingProfile(client,{...profile,interests:[]}), /INVALID_CHILLING_PROFILE/);
  assert.equal(calls.length,1);
});
test('sharing requires explicit consent, trims answer, and never uploads a client snapshot', async () => {
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:'request-id',error:null};}};
  await assert.rejects(data.requestChillingJoin(client,'post','hello',false), /CHILLING_CONSENT_REQUIRED/);
  assert.equal(calls.length,0);
  assert.equal(await data.requestChillingJoin(client,'post',' hi ',true),'request-id');
  assert.deepEqual(calls,[['request_chilling_join',{p_post_id:'post',p_answer:'hi',p_consent_version:'chilling-v1'}]]);
});
test('create uses one atomic RPC; invalid event cannot publish a partial legacy post', async () => {
  const calls=[];const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:'post-id',error:null};}};
  const draft={cityId:'vancouver',title:' 산책 ',body:' 같이 걸어요 ',question:' 기대하는 분위기는? ',event:{kind:'group',startsAt:'',endsAt:'',timezone:'',cadence:' 매주 토요일 ',capacity:8,category:'hobby'}};
  assert.equal(await data.createChillingEvent(client,draft),'post-id');
  assert.equal(calls.length,1);assert.equal(calls[0][0],'create_chilling_event');
  assert.deepEqual(calls[0][1],{p_city_id:'vancouver',p_title:'산책',p_body:'같이 걸어요',p_question:'기대하는 분위기는?',p_event:{eventKind:'group',startsAt:null,endsAt:null,timezone:null,cadence:'매주 토요일',capacity:8,category:'hobby'}});
  await assert.rejects(data.createChillingEvent(client,{...draft,event:{...draft.event,capacity:51}}));
  assert.equal(calls.length,1);
});

test('cover uploads before atomic creation and removes upload on rejected creation', async () => {
  const calls=[];
  const client={storage:{from:()=>({upload:async(path,bytes)=>{calls.push(['upload',path,bytes.byteLength]);return {error:null};},remove:async paths=>{calls.push(['remove',paths]);return {error:null};}})},rpc:async(name,args)=>{calls.push(['rpc',args]);return {error:new Error('HOST_LIMIT')};}};
  const draft={userId:'owner',cityId:'vancouver',title:'산책',body:'소개',question:'질문',event:{kind:'group',startsAt:'',endsAt:'',timezone:'',cadence:'매주',capacity:8,category:'hobby'},image:{base64:'aGk=',mimeType:'image/jpeg'}};
  await assert.rejects(data.createChillingEvent(client,draft),/HOST_LIMIT/);
  assert.equal(calls[0][0],'upload');assert.equal(calls[0][2],2);
  assert.deepEqual(calls[1][1].p_image_paths,[calls[0][1]]);
  assert.deepEqual(calls[2],['remove',[calls[0][1]]]);
  calls.length=0;
  await assert.rejects(data.createChillingEvent(client,{...draft,event:{...draft.event,capacity:51}}));
  assert.equal(calls.length,0,'invalid event never uploads');
});
