import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { handleWebshopRedirect, trackedWebshopUrl } from '../supabase/functions/webshop-redirect/handler.ts';

const merchantId = 'c2310000-0000-4000-8000-000000000001';
const eventId = 'c2320000-0000-4000-8000-000000000001';
const url = 'https://www.order.store/ca/store/jimoco-cafe-%26-pasta-austin/ZFgz2GjZSAuhlUYeO1fupA';
const params = { merchantId, eventId, session: 'random-session-1234567890', platform: 'web', source: 'comparison_sheet' };
const request = (values = params, method = 'GET') => new Request(`https://example.test/webshop-redirect?${new URLSearchParams(values)}`, { method });

test('redirect accepts the observed Canadian webshop and uses stable non-identifying UTM', () => {
  assert.equal(trackedWebshopUrl(url, merchantId), `${url}?utm_source=gling&utm_medium=referral&utm_campaign=webshop&utm_content=${merchantId}`);
  assert.ok(trackedWebshopUrl(url.replace('www.order.store', 'order.store'), merchantId));
  for (const bad of [
    url.replace('https:', 'http:'), url.replace('order.store', 'order.store.evil.test'),
    url.replace('www.order.store', 'user:secret@www.order.store'), url.replace('www.order.store', 'www.order.store:443'),
    url.replace('/ca/', '/us/'), url.replace('jimoco-cafe-', '../jimoco-cafe-'), url.replace('%26', '%2F'),
    `${url}?destination=https://evil.test`, `${url}#fragment`, `${url}\r\nLocation:https://evil.test`,
    url.replace('order.store', 'order-ub.com'), url.replace('order.store', 'ubereats.com'),
  ]) assert.equal(trackedWebshopUrl(bad, merchantId), null, bad);
  assert.equal(trackedWebshopUrl(url, 'not-a-uuid'), null);
});

test('GET resolves and logs exactly once per request through the service RPC dependency', async () => {
  const calls = [];
  const result = await handleWebshopRedirect(request(), {
    descriptor: async () => { throw new Error('GET must use the atomic resolver'); },
    resolve: async (input) => { calls.push(input); return { url: trackedWebshopUrl(url, merchantId) }; },
  });
  assert.equal(result.status, 302);
  assert.deepEqual(calls, [params]);
  assert.equal(result.headers.get('location'), trackedWebshopUrl(url, merchantId));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(await result.text(), '');
});

test('HEAD resolves registry without counting a click', async () => {
  let reads = 0;
  for (const values of [params, { merchantId }]) {
    const result = await handleWebshopRedirect(request(values, 'HEAD'), {
      descriptor: async (id) => { assert.equal(id, merchantId); reads++; return { url }; },
      resolve: async () => { throw new Error('HEAD must never log clicks'); },
    });
    assert.equal(result.status, 302);
    assert.equal(await result.text(), '');
  }
  assert.equal(reads, 2);
});

test('invalid query data, destination input and duplicate fields fail before any RPC', async () => {
  const dependencies = { descriptor: async () => assert.fail('unexpected lookup'), resolve: async () => assert.fail('unexpected event') };
  for (const patch of [
    { merchantId: 'wrong' }, { eventId: 'wrong' }, { session: 'short' }, { platform: 'desktop' },
    { source: 'arbitrary' }, { destination: url }, { session: 'x'.repeat(81) }, { session: 'has spaces 1234567890123' },
  ]) assert.equal((await handleWebshopRedirect(request({ ...params, ...patch }), dependencies)).status, 400);
  assert.equal((await handleWebshopRedirect(request({ merchantId }), dependencies)).status, 400);
  const duplicate = new Request(`${request().url}&merchantId=${merchantId}`);
  assert.equal((await handleWebshopRedirect(duplicate, dependencies)).status, 400);
  const post = await handleWebshopRedirect(request(params, 'POST'), dependencies);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('unknown, malicious and failing registry responses fail closed', async () => {
  for (const method of ['GET', 'HEAD']) {
    const missing = await handleWebshopRedirect(request(params, method), { descriptor: async () => null, resolve: async () => null });
    assert.equal(missing.status, 404);
    const failure = await handleWebshopRedirect(request(params, method), {
      descriptor: async () => { throw new Error('private information'); }, resolve: async () => { throw new Error('private information'); },
    });
    assert.equal(failure.status, 503);
    assert.ok(!(await failure.text()).includes('private information'));
  }
  for (const destination of ['https://evil.test', `${url}?utm_source=evil`, `${trackedWebshopUrl(url, merchantId)}&redirect=evil`]) {
    const result = await handleWebshopRedirect(request(), { descriptor: async () => ({ url }), resolve: async () => ({ url: destination }) });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('location'), null);
  }
});

test('migration keeps privileged tables private and public contracts separate', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261023180000_webshops.sql', import.meta.url), 'utf8');
  for (const name of ['get_public_webshop', 'get_city_business_links', 'get_city_webshops', 'record_webshop_event', 'resolve_webshop_redirect', 'get_admin_webshops', 'save_admin_webshop', 'import_admin_webshop_orders']) {
    assert.match(sql, new RegExp(`create function public\\.${name}\\(`));
  }
  assert.match(sql, /revoke all on private\.%I from public,anon,authenticated,service_role/);
  assert.match(sql, /grant execute on function public\.resolve_webshop_redirect\(uuid,uuid,text,text,text\) to service_role/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /perform private\.lock_partnership_actor\(\)/);
  assert.match(sql, /WEBSHOP_REPORT_CONFLICT/);
  assert.match(sql, /WEBSHOP_ORDER_CONFLICT/);
});

test('isolated local SQL rollback and concurrency checks', { skip: process.env.GLING_WEBSHOP_DB_CHECK !== '1' }, () => {
  const result = spawnSync('python3', ['-c', String.raw`from pathlib import Path
import json, re, runpy, sys, uuid
ROOT=Path.cwd()
helper=runpy.run_path(str(ROOT/'scripts/check-admin-partnerships.py'))
command=helper['command']; sql=helper['sql']
database='gling_webshop_check_'+uuid.uuid4().hex[:12]
created=False
try:
    dump=command(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-publications','--no-subscriptions','--exclude-extension=pg_cron','--exclude-extension=pg_net','--exclude-schema=cron','--exclude-schema=net'])
    assert dump.returncode==0,dump.stderr
    result=command(['createdb','-U','supabase_admin','--template=template0',database]); assert result.returncode==0,result.stderr
    created=True
    sql(database,dump.stdout)
    checker=ROOT/'scripts/check-business-identity.py'
    prefix=checker.read_text().split('before = sql(',1)[0].replace("sql = helper['sql']",'sql = isolated_sql')
    def isolated_sql(_db,source,check=True): return sql(database,source,check)
    namespace={'__file__':str(checker),'isolated_sql':isolated_sql}
    previous=sys.argv; sys.argv=[str(checker),'--profiles']
    try: exec(compile(prefix,str(checker),'exec'),namespace)
    finally: sys.argv=previous
    behavior=''
    if not sql(database,"select to_regclass('private.behavior_targets');").stdout.strip():
        behavior=(ROOT/'supabase/migrations/0073_behavior_analytics.sql').read_text().split('insert into private.behavior_targets',1)[0]
    source=behavior+'\n'+(ROOT/'supabase/migrations/0118_admin_mfa.sql').read_text()+'\n'+namespace['source']+'\n'+(ROOT/'supabase/migrations/20261015190000_admin_partnerships.sql').read_text()+'\n'+(ROOT/'supabase/migrations/20261023180000_webshops.sql').read_text()
    sql(database,'begin;\n'+source+'\ncommit;')
    fixture=(ROOT/'supabase/tests/webshops.check.sql').read_text()
    result=sql(database,fixture,False)
    output=result.stdout+result.stderr
    Path('/tmp/gling-webshop-db-output.txt').write_text(output)
    failures=re.findall(r'^\s*not ok.*$',output,re.M)
    assert result.returncode==0,output[-16000:]
    assert not failures,output
    assert re.search(r'^1\.\.\d+$',output,re.M),output
    assert sql(database,"select count(*) from private.webshops;").stdout.strip()=='0','fixture rollback left data'
    print(json.dumps({'database':database,'pgTapPassed':len(re.findall(r'^\s*ok \d+',output,re.M)),'rollbackVerified':True,'output':'/tmp/gling-webshop-db-output.txt'}),flush=True)
    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime,timedelta
    MID='c2310000-0000-4000-8000-000000000001'; MID2='c2310000-0000-4000-8000-000000000002'
    ADMIN='c2300000-0000-4000-8000-000000000001'; SESSION='c2300000-0000-4000-8000-000000000010'
    def auth(claims): return "select set_config('request.jwt.claims',"+literal(json.dumps(claims))+",true); set local role "+claims['role']+";\n"
    def literal(value): return "'"+value.replace("'","''")+"'"
    AUTH=auth({'sub':ADMIN,'role':'authenticated','aal':'aal2','session_id':SESSION,'app_metadata':{'role':'admin'}})
    OWNER=auth({'sub':'c2300000-0000-4000-8000-000000000002','role':'authenticated'})
    SERVICE=auth({'role':'service_role'})
    setup=fixture.split('select ok(private.valid_webshop_url',1)[0].removeprefix('-- Run only against an isolated local schema with this migration; everything rolls back.\n').removeprefix('begin;').replace('select no_plan();','')
    setup=setup[setup.index('insert into public.cities'):]
    sql(database,'begin;\n'+setup+'\ncommit;')
    config={'cityId':'webshop-test','enabled':True,'url':'https://www.order.store/ca/store/test-branch/ZFgz2GjZSAuhlUYeO1fupA','provider':'uber','placeKeys':['osm:node:123456789'],'comparisons':[],'verifiedAt':None,'promoCode':None,'checkoutComparison':None,'commissionBps':2500,'commissionBasisConfirmed':False,'commissionScope':None,'updatedAt':None}
    def save(mid,value): return "select public.save_admin_webshop('"+mid+"',"+literal(json.dumps(value))+"::jsonb)"
    sql(database,'begin;\n'+AUTH+save(MID,config)+'; commit;')
    config2={**config,'enabled':False,'url':None,'placeKeys':[]}
    sql(database,'begin;\n'+AUTH+save(MID2,config2)+'; commit;')
    def current(mid): return json.loads(sql(database,"select private.webshop_store('"+mid+"');").stdout)
    race=helper['race']; race.__globals__['AUTH']=AUTH
    def run(call,authorization=AUTH): return sql(database,'begin;\n'+authorization+call+'; select pg_sleep(0.2); commit;',False)
    cfg=current(MID)
    race(database,[save(MID,{**cfg,'promoCode':'ONE'}),save(MID,{**cfg,'promoCode':'TWO'})],'WEBSHOP_CHANGED')
    now=datetime.fromisoformat(json.loads(sql(database,'select to_jsonb(clock_timestamp());').stdout))
    order={'externalOrderId':'concurrent-one','orderedAt':(now-timedelta(hours=1)).isoformat(),'currency':'CAD','foodSubtotalCents':1000,'refundCents':0,'status':'completed','attribution':'provider_report'}
    report='c2330000-0000-4000-8000-000000000010'
    def report_call(rid,rows): return "select public.import_admin_webshop_orders('"+MID+"','"+rid+"',"+literal((now-timedelta(days=1)).isoformat())+","+literal(now.isoformat())+",'Synthetic concurrency report',"+literal(json.dumps(rows))+"::jsonb)"
    same=report_call(report,[order])
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,[same,same]))
    assert all(r.returncode==0 for r in results),[r.stderr for r in results]
    assert sql(database,'select count(*) from private.webshop_orders;').stdout.strip()=='1'
    assert sql(database,'select count(*) from private.webshop_reports;').stdout.strip()=='1'
    conflicting=[report_call(str(uuid.uuid4()),[{**order,'externalOrderId':'concurrent-conflict','foodSubtotalCents':amount}]) for amount in (1000,2000)]
    race(database,conflicting,'WEBSHOP_ORDER_CONFLICT')
    assert sql(database,'select count(*) from private.webshop_orders;').stdout.strip()=='2'
    assert sql(database,'select count(*) from private.webshop_reports;').stdout.strip()=='2','failed conflict left a report'
    cfg=current(MID); cfg2=current(MID2)
    race(database,[save(MID,{**cfg,'placeKeys':['osm:node:999999999']}),save(MID2,{**cfg2,'placeKeys':['osm:node:999999999']})],'WEBSHOP_PLACE_ALREADY_LINKED')
    assert sql(database,"select count(*) from private.webshop_place_links where place_key='osm:node:999999999';").stdout.strip()=='1'
    session='concurrent-owner-session-123'
    view="select public.record_webshop_event('"+MID+"','c2320000-0000-4000-8000-000000000010','"+session+"','ios','business_profile','sheet_view')"
    click="select public.resolve_webshop_redirect('"+MID+"','c2320000-0000-4000-8000-000000000011','"+session+"','ios','comparison_sheet')"
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda item:run(*item),[(view,OWNER),(click,SERVICE)]))
    assert all(r.returncode==0 for r in results),[r.stderr for r in results]
    assert sql(database,"select count(*) from private.webshop_events where session_id='"+session+"' and internal;").stdout.strip()=='2'
    wait=helper['blocked_recheck']; wait.__globals__['AUTH']=AUTH
    lock="select 1 from private.merchants where id='"+MID+"' for update"
    cfg=current(MID)
    for operation in (save(MID,{**cfg,'promoCode':'EXPIRED'}),same):
        sql(database,"update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='"+SESSION+"';")
        wait(database,lock,'select pg_sleep(2.1)',operation,'ADMIN_REQUIRED')
        sql(database,"update auth.sessions set not_after=null where id='"+SESSION+"';")
    print(json.dumps({'concurrencyPassed':7,'probes':['stale configuration','identical report retry','conflicting external order retry','exclusive place binding','internal owner/click race','configuration AAL2 expiry','report retry AAL2 expiry']}),flush=True)
    before_counts=sql(database,'select (select count(*) from private.webshop_orders),(select count(*) from private.webshop_reports),(select count(*) from private.webshop_audit),(select count(*) from private.webshop_events),(select count(*) from private.webshop_place_links);').stdout
    sql(database,"create or replace function public.get_public_webshop(p_merchant_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select null::jsonb; $$;")
    assert sql(database,"select public.get_public_webshop('"+MID+"') is null;").stdout.strip()=='t'
    assert sql(database,"select public.get_city_webshops('webshop-test');").stdout.strip()=='[]'
    result=run(click,SERVICE)
    assert result.returncode!=0 and 'WEBSHOP_UNAVAILABLE' in result.stderr,'public order rollback did not close redirect'
    after_counts=sql(database,'select (select count(*) from private.webshop_orders),(select count(*) from private.webshop_reports),(select count(*) from private.webshop_audit),(select count(*) from private.webshop_events),(select count(*) from private.webshop_place_links);').stdout
    assert before_counts==after_counts,'public order rollback changed links, orders, reports, audit or events'
    print('Data-preserving public order rollback verified.',flush=True)
finally:
    if created:
        result=command(['dropdb','-U','supabase_admin','--force',database]); assert result.returncode==0,result.stderr
        print('Disposable local database dropped.',flush=True)
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 150_000, maxBuffer: 4_000_000 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"pgTapPassed": [1-9][0-9]*/);
  assert.match(result.stdout, /"concurrencyPassed": 7/);
  assert.match(result.stdout, /Data-preserving public order rollback verified/);
  assert.match(result.stdout, /Disposable local database dropped/);
  process.stdout.write(result.stdout);
});
