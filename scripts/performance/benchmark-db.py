#!/usr/bin/env python3
"""Local Docker-only synthetic SQL benchmark; every fixture rolls back.
Usage: python3 scripts/performance/benchmark-db.py [container] [label]
Requires local-bootstrap.sql + application migrations. Never accepts a remote DSN.
"""
import json, pathlib, re, statistics, subprocess, sys
container = sys.argv[1] if len(sys.argv) > 1 else 'gling-perf-20260912'
label = sys.argv[2] if len(sys.argv) > 2 else 'current'
def sql(source):
    result = subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], input=source, text=True, capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr)
    return result.stdout + '\n'.join(line for line in result.stderr.splitlines() if 'WORKER:' in line)
fixture = """
begin;
set local session_replication_role=replica;
insert into auth.users(id,email,raw_app_meta_data) select md5('perf-user-'||n)::uuid,'perf-'||n||'@example.invalid','{{}}' from generate_series(0,{users}) n;
insert into public.profiles(id,nickname,city_id) select md5('perf-user-'||n)::uuid,'perf-user-'||n,'vancouver' from generate_series(0,{users}) n;
"""
results=[]
for count in [10,100,1000,10000]:
    source=fixture.format(users=count)+f"""
insert into public.notification_preferences(user_id,interests,interest_tag_ids) select md5('perf-user-'||n)::uuid,true,array[1] from generate_series(1,{count}) n;
set local session_replication_role=origin;
analyze public.profiles; analyze public.notification_preferences;
create temp table timings(ms double precision);
do $$ declare started timestamptz; begin for n in 1..4 loop
started:=clock_timestamp();
insert into public.posts(author_id,city_id,tag_id,title,body) values(md5('perf-user-0')::uuid,'vancouver',1,'Benchmark post '||n,'Synthetic benchmark content '||n);
insert into timings values(extract(epoch from clock_timestamp()-started)*1000);
end loop; end $$;
select 'TIMES:'||json_agg(ms) from timings;
rollback;
"""
    source=source.replace('rollback;', """
do $$ declare started timestamptz; examined integer; begin
if to_regprocedure('private.process_discovery_posts(integer)') is not null then
 started:=clock_timestamp(); examined:=private.process_discovery_posts(500);
 raise notice 'WORKER:%',json_build_object('examined',examined,'ms',extract(epoch from clock_timestamp()-started)*1000);
 if examined>500 then raise exception 'unbounded worker'; end if;
end if; end $$;
rollback;
""")
    out=sql(source); times=json.loads(re.search(r'TIMES:(.*)',out)[1])[1:]
    results.append(dict(path='publish',recipients=count,median_ms=round(statistics.median(times),3),samples_ms=times));print(results[-1],flush=True)
    worker=re.search(r'WORKER:(.*)',out)
    if worker:
        results.append(dict(path='worker',recipients=count,**json.loads(worker[1])));print(results[-1],flush=True)
for count in [10000,100000]:
    source=fixture.format(users=999)+f"""
insert into public.posts(id,author_id,city_id,tag_id,title,body,hashtags,posted_on,created_at)
select md5('perf-post-'||n)::uuid,md5('perf-user-'||(n%1000))::uuid,'vancouver',case when n%1000=0 then 4 else 1 end,
case when n%10000=0 then 'rare-match' else 'common title' end,'Community text '||n,
array['hiking','local'||(n%100)],current_date,now() - (n%30)*interval '1 day' - n*interval '1 millisecond'
from generate_series(1,{count}) n;
set local session_replication_role=origin;
do $$ begin
 if exists(select 1 from public.posts p left join public.tags t on t.id=p.tag_id where t.id is null) then raise exception 'invalid fixture category'; end if;
end $$;
analyze public.posts; analyze public.profiles;
"""
    for name,query in [('category',"select * from public.get_public_feed_page('vancouver',4::smallint)"),('search_common',"select * from public.get_public_feed_page('vancouver',null,'common')"),('search_rare',"select * from public.get_public_feed_page('vancouver',null,'rare-match')"),('search_none',"select * from public.get_public_feed_page('vancouver',null,'no-matching-needle')"),('trending',"select * from public.get_trending_hashtags('vancouver')")]:
        source+=f"select 'QUERY:{name}';\n"+('\n'.join(f'explain (analyze,buffers,format json) {query};' for _ in range(4)))+'\n'
    out=sql(source+'rollback;');path=pathlib.Path('/tmp')/f'gling-db-{label}-{count}-plans.txt';path.write_text(out)
    for section in out.split('QUERY:')[1:]:
        name=section.splitlines()[0];times=[float(x) for x in re.findall(r'"Execution Time": ([\d.]+)',section)][1:]
        results.append(dict(path=name,posts=count,median_ms=round(statistics.median(times),3),samples_ms=times));print(results[-1],flush=True)
pathlib.Path(f'/tmp/gling-db-{label}.json').write_text(json.dumps(results,indent=2)+'\n')
