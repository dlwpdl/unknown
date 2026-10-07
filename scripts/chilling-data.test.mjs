import assert from 'node:assert/strict';
import test from 'node:test';
import * as data from '../src/lib/chilling-data.ts';

const profile = { intro: ' 함께 걸어요 ', interests: [' 산책 ', '커피'], promptOne: '느긋하게', promptTwo: '편한 사람들' };
test('meetup errors explain the same meetup and admission failure instead of direct conversations', () => {
  assert.match(data.getChillingError(new Error('REQUEST_COOLDOWN')), /이 모임.*24시간/);
  assert.match(data.getChillingError(new Error('REQUEST_ALREADY_RESOLVED')), /참여 신청.*처리/);
  assert.match(data.getChillingError(new Error('MEETUP_FULL')), /정원/);
  assert.equal(data.getChillingErrorCode(new Error('MEETUP_FULL')), 'MEETUP_FULL');
  assert.equal(data.getChillingErrorCode(new Error('offline')), null);
  assert.doesNotMatch(data.getChillingError(new Error('offline')), /승인|거절/);
});

test('a resolved request status contains no profile and is returned only to its requester or host', async () => {
  const row = { id: 'request', host_id: 'host', requester_id: 'viewer', status: 'cancelled' };
  const filters = [];
  const query = { select() { return this; }, eq(key, value) { filters.push([key,value]); return this; }, async maybeSingle() { return { data: row, error: null }; } };
  const client = { from: () => query };
  assert.equal((await data.loadMeetupRequestStatus(client, 'request', 'host')).status, 'cancelled');
  assert.equal((await data.loadMeetupRequestStatus(client, 'request', 'viewer')).status, 'cancelled');
  assert.equal(await data.loadMeetupRequestStatus(client, 'request', 'stranger'), null);
  assert.ok(filters.every(([key,value]) => key === 'id' && value === 'request'));
  query.maybeSingle = async () => ({ data: null, error: new Error('offline') });
  await assert.rejects(data.loadMeetupRequestStatus(client, 'request', 'host'), /offline/);
});

test('participation lookup is scoped to the current requester and preserves every resolved state', async () => {
  for (const status of ['pending', 'approved', 'rejected', 'cancelled']) {
    const filters = [];
    const row = { id: 'request', post_id: 'post', host_id: 'host', requester_id: 'viewer', status, created_at: '2026-10-05T12:00:00Z', responded_at: null };
    const query = { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, async maybeSingle() { return { data: row, error: null }; } };
    const result = await data.loadMeetupParticipation({ from: name => { assert.equal(name, 'meetup_requests'); return query; } }, 'post', 'viewer');
    assert.equal(result.status, status);
    assert.deepEqual(filters, [['post_id', 'post'], ['requester_id', 'viewer']]);
  }
  const failure = new Error('offline');
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: failure }; } };
  await assert.rejects(data.loadMeetupParticipation({ from: () => query }, 'post', 'viewer'), /offline/);
});

test('application identity is loaded only after the server permits the private snapshot', async () => {
  let reads = 0;
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { reads++; return { data: { id: 'request', status: 'pending', host_id: 'host', requester_id: 'viewer', requester: { nickname: '산책친구', city_id: 'vancouver', avatar_path: null }, post: { title: '산책 모임' } }, error: null }; } };
  const client = { rpc: async () => ({ data: null, error: null }), from: () => query };
  assert.equal(await data.loadChillingApplication(client, 'request', 'viewer'), null);
  assert.equal(reads, 0, 'denied snapshots never trigger an identity query');
  client.rpc = async () => ({ data: { postId: 'post', requesterId: 'viewer', profile, answer: '함께하고 싶어요', question: '기대하는 것은?', consentVersion: 'chilling-v1', consentedAt: '2026-10-05T12:00:00Z' }, error: null });
  const application = await data.loadChillingApplication(client, 'request', 'viewer');
  assert.equal(application.request.status, 'pending');
  assert.equal(application.request.requester.nickname, '산책친구');
  assert.equal(application.answer, '함께하고 싶어요');
});

test('a host discards a snapshot revoked during metadata loading while its requester keeps their own copy', async () => {
  const snapshot = { postId: 'post', requesterId: 'viewer', profile, answer: '신청 답변' };
  for (const status of ['cancelled', 'rejected', null]) {
    const query = { select() { return this; }, eq() { return this; }, async maybeSingle() {
      return { data: status ? { id: 'request', host_id: 'host', requester_id: 'viewer', status } : null, error: null };
    } };
    const client = { rpc: async () => ({ data: snapshot, error: null }), from: () => query };
    assert.equal(await data.loadChillingApplication(client, 'request', 'host'), null);
    assert.equal((await data.loadChillingApplication(client, 'request', 'viewer')).answer, '신청 답변');
  }
});

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
  // 업로드 실패 시 원본과 함께 만들어 둔 썸네일도 지운다.
  assert.deepEqual(calls[2],['remove',[calls[0][1],calls[0][1].replace(/\.[^.]+$/,'.thumb.webp')]]);
  calls.length=0;
  await assert.rejects(data.createChillingEvent(client,{...draft,event:{...draft.event,capacity:51}}));
  assert.equal(calls.length,0,'invalid event never uploads');
});
