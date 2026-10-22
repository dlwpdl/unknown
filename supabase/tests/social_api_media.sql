-- Rollback-only boundary check: even an app admin cannot read or insert these objects.
begin;
insert into storage.objects(bucket_id,name,owner_id,metadata)
values('sns-media','rollback-only-boundary-check','cb270ce5-ef84-47a0-b3b3-93380afc4d1d','{}');
set local role anon;
do $$ begin
  if exists(select 1 from storage.objects where bucket_id='sns-media') then raise exception 'ANON_READ_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('sns-media','anonymous-forbidden');
    raise exception 'ANON_INSERT_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local request.jwt.claims='{"sub":"cb270ce5-ef84-47a0-b3b3-93380afc4d1d","role":"authenticated","app_metadata":{"role":"admin"}}';
set local role authenticated;
do $$ begin
  if exists(select 1 from storage.objects where bucket_id='sns-media') then raise exception 'APP_ADMIN_READ_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name,owner_id) values('sns-media','app-admin-forbidden','cb270ce5-ef84-47a0-b3b3-93380afc4d1d');
    raise exception 'APP_ADMIN_INSERT_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
