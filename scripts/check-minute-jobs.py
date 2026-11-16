"""One minute job pgTAP in a disposable, network-less container. Stubs stand in for the queues, vault, pg_net and pg_cron;
the queue columns and wake conditions were also checked read-only against production before the change."""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'gling-minute-jobs-check-' + uuid.uuid4().hex[:12]
DATABASE = 'minute_jobs_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATIONS = [ROOT / 'supabase/migrations/20261115200000_minute_jobs_one_run.sql',
              ROOT / 'supabase/migrations/20261115230000_safety_reclaim_all_targets.sql']
# The real queue claim, so the reclaim test runs claim_safety_reviews_v2 on top of it unchanged.
CLAIM = re.search(r'create function public\.claim_safety_reviews\(.*?\n\$\$;',
                  (ROOT / 'supabase/migrations/0010_abuse_controls.sql').read_text(), re.S).group(0)


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', DATABASE,
                    '-v', 'ON_ERROR_STOP=1'], source, check)


STUBS = """
create extension if not exists pgtap;
create schema if not exists auth;
create function auth.role() returns text language sql as $$ select nullif(current_setting('test.role', true), '') $$;
create schema if not exists private;
create table private.push_delivery_queue(id bigserial primary key, status text not null, next_attempt_at timestamptz not null default now(),
  lease_until timestamptz, created_at timestamptz not null default now());
create table public.safety_review_queue(id bigserial primary key, target_type text not null, status text not null,
  next_attempt_at timestamptz, attempts integer not null default 0, updated_at timestamptz not null default now(),
  target_id uuid not null default gen_random_uuid(), content_hash text, last_error text, created_at timestamptz not null default now());
create table private.minute_calls(id bigserial primary key, step text);
create function private.step(p text) returns integer language plpgsql as $$ begin
  insert into private.minute_calls(step) values (p);
  if current_setting('test.fail', true) = p then raise exception 'boom %', p; end if;
  return 0; end $$;
create function private.process_discovery_posts(p_limit integer) returns integer language sql as $$ select private.step('discovery') $$;
create function private.expire_chilling_events() returns void language sql as $$ select private.step('chilling'); $$;
create function private.send_meetup_reminders(p_now timestamptz default now()) returns integer language sql as $$ select private.step('reminders') $$;
create function private.expire_meetup_waitlist_offers() returns integer language sql as $$ select private.step('waitlist') $$;
create function private.send_due_meetup_announcements() returns integer language sql as $$ select private.step('announcements') $$;
create function private.flush_account_security_logins(p_now timestamptz default now()) returns integer language plpgsql as $$ begin
  perform private.step('flush');
  if current_setting('test.flush_enqueues', true) = 'on' then insert into private.push_delivery_queue(status) values ('pending'); end if;
  return 0; end $$;
create schema if not exists vault;
create table if not exists vault.secrets(name text primary key, secret text);
create or replace view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(s text, n text) returns uuid language sql as $$ insert into vault.secrets values (n, s); select gen_random_uuid() $$;
create schema if not exists net;
create table net.calls(id bigserial primary key, url text, headers jsonb, body jsonb, timeout_ms integer);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$ begin
  insert into net.calls(url, headers, body, timeout_ms) values (url, headers, body, timeout_milliseconds);
  if url like '%' || nullif(current_setting('test.fail_http', true), '') then raise exception 'http %', url; end if;
  return 1; end $$;
create schema if not exists cron;
create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job(jobname,schedule,command) values (n,s,c) on conflict(jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $$;
create function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;
insert into cron.job(jobname, schedule, command) values
  ('gling-safety-monitor-every-minute','* * * * *','old'), ('gling-discovery-posts','* * * * *','old'), ('gling-push-delivery','* * * * *','old'),
  ('gling-chilling-expiry','* * * * *','old'), ('gling-meetup-reminders','* * * * *','old'), ('gling-meetup-convenience','* * * * *','old'),
  ('gling-meetup-announcements','* * * * *','old'), ('gling-cron-history-retention','47 8 * * *','keep'), ('gling-meetup-tidy','*/10 * * * *','keep');
insert into vault.secrets values ('gling_push_project_url','https://push.supabase.co'), ('gling_push_notifications_secret','push-secret'),
  ('gling_project_url','https://safety.supabase.co'), ('gling_safety_monitor_secret','safety-secret');
"""

try:
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=minute-jobs-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(240):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', DATABASE])
    sql(STUBS)
    sql(CLAIM)
    for migration in MIGRATIONS + MIGRATIONS:  # rerunnable
        sql(migration.read_text())
    result = sql((ROOT / 'supabase/tests/minute_jobs.test.sql').read_text(), False)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output[-10000:]
    assert not re.search(r'^\s*not ok \d+', output, re.M), output
    assert re.search(r'^1\.\.\d+$', output, re.M), output
    print(json.dumps({'pgTapPassed': len(re.findall(r'^\s*ok \d+', output, re.M)), 'disposableContainer': CONTAINER,
                      'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
