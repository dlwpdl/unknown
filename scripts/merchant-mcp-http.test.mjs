import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { handleMerchantMcpRequest } from '../supabase/functions/_shared/merchant-mcp-http.ts';

const resource='https://example.supabase.co/functions/v1/merchant-mcp';
const config={resource,allowedOrigins:['https://gling.ej-entertainment.com','https://claude.ai']};
const claims={sub:'mcp:14040000-0000-4000-8000-000000000001',gling_actor_id:'14000000-0000-4000-8000-000000000001',session_id:'14070000-0000-4000-8000-000000000001',scope:'offline_access',client_id:'14030000-0000-4000-8000-000000000001',gling_connection_id:'14040000-0000-4000-8000-000000000001',iss:'https://example.supabase.co/auth/v1',aud:resource,role:'gling_mcp',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)};
const packet={jsonrpc:'2.0',id:1,method:'tools/list'};
const request=(headers={},body=JSON.stringify(packet))=>new Request(resource,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer signed-token',...headers},body});
const execute=async()=>({businesses:[],allow_drafts:true,allow_publish:false});

test('protected resource discovery is public; unauthenticated MCP requests prompt OAuth without invoking dispatch',async()=>{
  let calls=0;const verify=async()=>{calls++;throw new Error('invalid');};
  const metadata=await handleMerchantMcpRequest(new Request(`${resource}/.well-known/oauth-protected-resource`),config,verify,execute);
  assert.equal(metadata.status,200);assert.equal((await metadata.json()).resource,resource);assert.equal(calls,0);
  const workerMetadata=await handleMerchantMcpRequest(new Request('http://worker/merchant-mcp/.well-known/oauth-protected-resource'),config,verify,execute);
  assert.equal(workerMetadata.status,200);assert.deepEqual((await workerMetadata.json()).scopes_supported,['offline_access']);
  const denied=await handleMerchantMcpRequest(request({authorization:''}),config,verify,execute);
  assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata=/);assert.equal(calls,0);
});
test('origins, media type, protocol, actual streamed bytes and invalid JSON are checked before tools run',async()=>{
  let calls=0;const verify=async()=>{calls++;return claims;};
  for(const [headers,body,status] of [
    [{origin:'https://evil.example'},JSON.stringify(packet),403],
    [{origin:'null'},JSON.stringify(packet),403],
    [{'content-type':'text/plain'},JSON.stringify(packet),415],
    [{'mcp-protocol-version':'2099-01-01'},JSON.stringify(packet),400],
    [{},'a'.repeat(40001),413],[{},'{broken',400],
  ]) assert.equal((await handleMerchantMcpRequest(request(headers,body),config,verify,execute)).status,status);
  assert.equal(calls,0);
  const unsupported=await handleMerchantMcpRequest(new Request(resource),config,verify,execute);assert.equal(unsupported.status,405);
});
test('every request uses verified dedicated claims and a current connection, including tools/list and notifications',async()=>{
  const calls=[];
  const dispatch=async(actor,name,args)=>{calls.push({actor,name,args});return execute();};
  const ok=await handleMerchantMcpRequest(request({origin:'https://claude.ai'}),config,async()=>claims,dispatch);
  assert.equal(ok.status,200);assert.equal(ok.headers.get('access-control-allow-origin'),'https://claude.ai');
  assert.equal((await ok.json()).result.tools.length,9);assert.equal(calls[0].name,'_context');
  const worker=new Request('http://worker/merchant-mcp',{method:'POST',headers:request().headers,body:JSON.stringify(packet)});
  assert.equal((await handleMerchantMcpRequest(worker,config,async()=>claims,execute)).status,200);
  const normal=await handleMerchantMcpRequest(request(),config,async()=>({...claims,aud:'authenticated',role:'authenticated'}),dispatch);
  assert.equal(normal.status,401);assert.equal(calls.length,1);
  const revoked=await handleMerchantMcpRequest(request(),config,async()=>claims,async()=>{throw new Error('MCP_CONNECTION_REQUIRED');});
  assert.equal(revoked.status,401);
  const notification=await handleMerchantMcpRequest(request({},JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})),config,async()=>claims,dispatch);
  assert.equal(notification.status,202);assert.equal(calls.length,2);
});
test('the installed Supabase SDK verifies ES256 signatures before the HTTP boundary trusts any token claims',async()=>{
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk={...(await crypto.subtle.exportKey('jwk',keys.publicKey)),kid:'local-mcp-test',alg:'ES256',use:'sig'};
  const auth=createClient('https://example.supabase.co','local-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url)=>{
    assert.match(String(url),/\.well-known\/jwks\.json/);return Response.json({keys:[jwk]});
  }}}).auth;
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'ES256',kid:jwk.kid,typ:'JWT'})}.${encode(claims)}`;
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(unsigned));
  const token=`${unsigned}.${Buffer.from(signature).toString('base64url')}`;
  const verify=async(value)=>{const {data,error}=await auth.getClaims(value);if(error||!data)throw new Error('AUTH_REQUIRED');return data.claims;};
  assert.equal((await handleMerchantMcpRequest(request({authorization:`Bearer ${token}`}),config,verify,execute)).status,200);
  const forged=`${unsigned.split('.')[0]}.${encode({...claims,sub:'14000000-0000-4000-8000-000000000002'})}.${Buffer.from(signature).toString('base64url')}`;
  assert.equal((await handleMerchantMcpRequest(request({authorization:`Bearer ${forged}`}),config,verify,execute)).status,401);
});
