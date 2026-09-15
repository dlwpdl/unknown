#!/usr/bin/env python3
"""Check SKIP LOCKED against a second local PostgreSQL session; clean up fixture."""
import subprocess, sys, time, uuid
container = sys.argv[1] if len(sys.argv)>1 else 'gling-perf-20260912'
command = ['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
def sql(source):
    result = subprocess.run(command,input=source,text=True,capture_output=True,check=True)
    return result.stdout.strip()
author, post = uuid.uuid4(), uuid.uuid4()
locker = None
try:
    sql(f"""begin;
    insert into auth.users(id,email,raw_app_meta_data) values('{author}','{author}@example.invalid','{{}}');
    insert into public.profiles(id,nickname,city_id) values('{author}','lock-{author.hex[:12]}','vancouver');
    insert into public.posts(id,author_id,city_id,tag_id,title,body) values('{post}','{author}','vancouver',1,'Lock fixture','Local queue concurrency check');
    commit;""")
    locker = subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    locker.stdin.write(f"""set application_name='gling-discovery-lock-check'; begin;
    select post_id from private.discovery_post_queue where post_id='{post}' for update;
    select pg_sleep(3); rollback;""")
    locker.stdin.close()
    deadline=time.monotonic()+5
    while sql("select exists(select 1 from pg_stat_activity where application_name='gling-discovery-lock-check' and wait_event='PgSleep')") != 't':
        if time.monotonic()>deadline: raise AssertionError('locker did not acquire row')
        time.sleep(.05)
    # If the worker waits for the row lock this statement times out.
    sql("begin; set local statement_timeout='500ms'; select private.process_discovery_posts(1); rollback;")
    assert sql(f"select count(*) from private.discovery_post_queue where post_id='{post}'") == '1'
    print('PASS: concurrent worker skips locked queue row within 500ms')
finally:
    if locker is not None:
        locker.wait(timeout=10)
        assert locker.returncode == 0, locker.stderr.read()
    sql(f"""begin;
    delete from public.safety_review_queue where target_id='{post}';
    delete from public.notifications where target_id='{post}';
    delete from public.posts where id='{post}';
    delete from public.profiles where id='{author}';
    delete from auth.users where id='{author}'; commit;""")
