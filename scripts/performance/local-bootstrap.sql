-- Minimal local-only Auth/Storage contracts for SQL tests on the Supabase Postgres image.
-- These are NOT production migrations and do not test GoTrue or Storage HTTP behavior.
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(auth.jwt()->>'sub',''))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
alter table auth.users add column email_confirmed_at timestamptz, add column banned_until timestamptz, add column deleted_at timestamptz, add column is_anonymous boolean default false;
create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade, created_at timestamptz default now(), updated_at timestamptz default now(), not_after timestamptz, ip inet, refresh_token_hmac_key text);
create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text, provider_id text, created_at timestamptz default now(), last_sign_in_at timestamptz);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,unique(bucket_id,name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema storage to anon,authenticated;
grant all on storage.objects to anon,authenticated;
-- supabase_realtime publication is installed by the image.
create extension pgtap;

alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
grant all on all tables in schema auth to postgres;
create extension pg_cron;
create extension pg_net with schema extensions;
grant usage on schema cron to postgres;
grant all on all tables in schema cron to postgres;
