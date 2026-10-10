-- External credentials and receipts stay private; every caller uses current account capability.
create table private.merchant_naver_connections (
  merchant_id uuid primary key references private.merchants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  generation uuid not null default gen_random_uuid(), encrypted_tokens text not null check(length(encrypted_tokens) between 40 and 20000),
  expires_at timestamptz not null, connected_at timestamptz not null default now()
);
create table private.merchant_naver_states (
  state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
  merchant_id uuid not null references private.merchants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes',
  consumed_at timestamptz, completed_at timestamptz
);
create table private.merchant_naver_requests (
  id uuid primary key, merchant_id uuid not null references private.merchants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  draft_id uuid references private.merchant_workspace_drafts(id) on delete set null,
  draft_revision timestamptz not null, board_url text not null,
  club_id text not null check(club_id ~ '^[1-9][0-9]{0,9}$'), menu_id text not null check(menu_id ~ '^[1-9][0-9]{0,8}$'),
  connection_generation uuid not null, snapshot jsonb not null,
  status text not null default 'prepared' check(status in ('prepared','in_flight','succeeded','failed','uncertain')),
  article_url text, error_code text, created_at timestamptz not null default now(), completed_at timestamptz,
  unique(draft_id,draft_revision)
);
create index merchant_naver_request_owner_idx on private.merchant_naver_requests(merchant_id,created_at desc);
create index merchant_naver_state_expiry_idx on private.merchant_naver_states(expires_at);
alter table private.merchant_naver_connections enable row level security;
alter table private.merchant_naver_states enable row level security;
alter table private.merchant_naver_requests enable row level security;
revoke all on private.merchant_naver_connections,private.merchant_naver_states,private.merchant_naver_requests from public,anon,authenticated,service_role;

create function private.assert_naver_merchant(p_merchant_id uuid,p_user_id uuid)
returns private.merchants language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=p_user_id for share;
  perform private.assert_active_account(p_user_id);
  perform 1 from auth.users where id=p_user_id and raw_app_meta_data->'merchant_enabled'='true'::jsonb for share;
  if not found then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  select * into m from private.merchants where id=p_merchant_id for share;
  if m.id is null or m.owner_id is distinct from p_user_id then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if m.status='paused' then raise exception 'MERCHANT_OPERATIONS_PAUSED'; end if;
  if m.consent='revoked' then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  return m;
end;
$$;
revoke all on function private.assert_naver_merchant(uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_merchant_naver_cafe(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare connection jsonb; requests jsonb;
begin
  perform private.assert_naver_merchant(p_merchant_id,auth.uid());
  select jsonb_build_object('connected_at',connected_at,'expires_at',expires_at) into connection
    from private.merchant_naver_connections where merchant_id=p_merchant_id and user_id=auth.uid();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into requests from
    (select id,draft_id,draft_revision,board_url,status,article_url,error_code,created_at,completed_at
     from private.merchant_naver_requests where merchant_id=p_merchant_id and user_id=auth.uid() order by created_at desc limit 20)x;
  return jsonb_build_object('connection',connection,'requests',requests);
end;
$$;

create function public.begin_merchant_naver_oauth(p_merchant_id uuid,p_state_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_naver_merchant(p_merchant_id,auth.uid());
  if p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_NAVER_STATE'; end if;
  perform private.enforce_rate_limit('merchant-naver-connect',5,interval '1 hour');
  delete from private.merchant_naver_states where expires_at<now();
  insert into private.merchant_naver_states(state_hash,merchant_id,user_id) values(p_state_hash,p_merchant_id,auth.uid());
end;
$$;

create function public.consume_merchant_naver_oauth(p_state_hash text,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.merchant_naver_states;
begin
  select * into s from private.merchant_naver_states where state_hash=p_state_hash for update;
  if s.state_hash is null or s.user_id is distinct from p_user_id or s.expires_at<=now() or s.consumed_at is not null then raise exception 'INVALID_NAVER_STATE'; end if;
  perform private.assert_naver_merchant(s.merchant_id,s.user_id);
  update private.merchant_naver_states set consumed_at=now() where state_hash=s.state_hash;
  return jsonb_build_object('merchant_id',s.merchant_id,'user_id',s.user_id);
end;
$$;

create function public.complete_merchant_naver_oauth(p_state_hash text,p_encrypted_tokens text,p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare s private.merchant_naver_states;
begin
  select * into s from private.merchant_naver_states where state_hash=p_state_hash for update;
  if s.state_hash is null or s.expires_at<=now() or s.consumed_at is null or s.completed_at is not null then raise exception 'INVALID_NAVER_STATE'; end if;
  perform private.assert_naver_merchant(s.merchant_id,s.user_id);
  if p_encrypted_tokens is null or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '2 days' then raise exception 'INVALID_NAVER_TOKEN'; end if;
  if exists(select 1 from private.merchant_naver_connections where merchant_id=s.merchant_id and connected_at>s.created_at) then raise exception 'INVALID_NAVER_STATE'; end if;
  insert into private.merchant_naver_connections(merchant_id,user_id,encrypted_tokens,expires_at)
    values(s.merchant_id,s.user_id,p_encrypted_tokens,p_expires_at)
    on conflict(merchant_id) do update set user_id=excluded.user_id,encrypted_tokens=excluded.encrypted_tokens,expires_at=excluded.expires_at,generation=gen_random_uuid(),connected_at=now();
  update private.merchant_naver_states set completed_at=now() where state_hash=s.state_hash;
end;
$$;

create function public.get_merchant_naver_tokens(p_merchant_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_naver_merchant(p_merchant_id,p_user_id);
  return (select jsonb_build_object('encrypted_tokens',encrypted_tokens,'expires_at',expires_at,'generation',generation)
    from private.merchant_naver_connections where merchant_id=p_merchant_id and user_id=p_user_id);
end;
$$;

create function public.refresh_merchant_naver_tokens(p_merchant_id uuid,p_user_id uuid,p_generation uuid,p_encrypted_tokens text,p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_naver_merchant(p_merchant_id,p_user_id);
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '2 days' then raise exception 'INVALID_NAVER_TOKEN'; end if;
  update private.merchant_naver_connections set encrypted_tokens=p_encrypted_tokens,expires_at=p_expires_at
    where merchant_id=p_merchant_id and user_id=p_user_id and generation=p_generation;
  if not found then raise exception 'NAVER_RECONNECT_REQUIRED'; end if;
end;
$$;

create function public.disconnect_merchant_naver_cafe(p_merchant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_naver_merchant(p_merchant_id,auth.uid());
  delete from private.merchant_naver_states where merchant_id=p_merchant_id and user_id=auth.uid();
  delete from private.merchant_naver_connections where merchant_id=p_merchant_id and user_id=auth.uid();
end;
$$;

create function public.reserve_merchant_naver_publish(p_merchant_id uuid,p_draft_id uuid,p_expected_updated_at timestamptz,p_request_id uuid,p_club_id text,p_menu_id text,p_image_paths text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; d private.merchant_workspace_drafts; c private.merchant_naver_connections; r private.merchant_naver_requests; snap jsonb; board text;
begin
  m:=private.assert_naver_merchant(p_merchant_id,auth.uid());
  if p_request_id is null or p_club_id is null or p_menu_id is null or p_club_id !~ '^[1-9][0-9]{0,9}$' or p_menu_id !~ '^[1-9][0-9]{0,8}$' then raise exception 'INVALID_NAVER_BOARD_URL'; end if;
  select * into d from private.merchant_workspace_drafts where id=p_draft_id and merchant_id=m.id for update;
  if d.id is null or d.archived_at is not null then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
  board:='https://cafe.naver.com/f-e/cafes/'||p_club_id||'/menus/'||p_menu_id;
  select * into r from private.merchant_naver_requests where id=p_request_id or (draft_id=d.id and draft_revision=p_expected_updated_at) order by created_at limit 1;
  if r.id is not null then
    if r.merchant_id<>m.id or r.user_id is distinct from auth.uid() or r.draft_id<>d.id or r.draft_revision is distinct from p_expected_updated_at
      or r.board_url<>board or r.snapshot->'image_paths' is distinct from to_jsonb(p_image_paths) then raise exception 'MERCHANT_REQUEST_CONFLICT'; end if;
    return to_jsonb(r);
  end if;
  if d.approved_at is null or d.external_url is not null then raise exception 'MERCHANT_DRAFT_APPROVAL_REQUIRED'; end if;
  if p_expected_updated_at is null or d.updated_at<>p_expected_updated_at or p_image_paths is null or d.image_paths<>p_image_paths then raise exception 'MERCHANT_DRAFT_CHANGED'; end if;
  perform private.assert_content_allowed(concat_ws(' ',d.title,d.body));
  if exists(select 1 from private.watch_terms w where w.active and position(regexp_replace(lower(w.term),'[[:space:][:punct:]]+','','g') in
    regexp_replace(lower(normalize(concat_ws(' ',d.title,d.body),NFKC)),'[[:space:][:punct:]]+','','g'))>0) then raise exception 'NAVER_CONTENT_REVIEW_REQUIRED'; end if;
  if cardinality(d.image_paths)>6 or exists(select 1 from unnest(d.image_paths)path where path !~ ('^'||auth.uid()::text||'/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$')) then raise exception 'INVALID_IMAGE_PATH'; end if;
  if exists(select 1 from unnest(d.image_paths)path where not exists(select 1 from storage.objects o where o.bucket_id='post-images' and o.name=path
    and coalesce((o.metadata->>'size')::bigint,0) between 1 and 2097152 and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp'))) then raise exception 'NAVER_INVALID_PHOTO'; end if;
  select * into c from private.merchant_naver_connections where merchant_id=m.id and user_id=auth.uid();
  if c.merchant_id is null or c.expires_at<=now() then raise exception 'NAVER_RECONNECT_REQUIRED'; end if;
  snap:=jsonb_build_object('title',d.title,'body',d.body,'original_url',d.original_url,'image_paths',d.image_paths);
  insert into private.merchant_naver_requests(id,merchant_id,user_id,draft_id,draft_revision,board_url,club_id,menu_id,connection_generation,snapshot)
    values(p_request_id,m.id,auth.uid(),d.id,d.updated_at,board,p_club_id,p_menu_id,c.generation,snap) returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.claim_merchant_naver_publish(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.merchant_naver_requests; d private.merchant_workspace_drafts;
begin
  select * into r from private.merchant_naver_requests where id=p_request_id for update;
  if r.id is null or r.user_id is distinct from auth.uid() then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  perform private.assert_naver_merchant(r.merchant_id,auth.uid());
  if r.status<>'prepared' then return jsonb_build_object('should_send',false,'request',to_jsonb(r)); end if;
  select * into d from private.merchant_workspace_drafts where id=r.draft_id and merchant_id=r.merchant_id for update;
  if d.id is null or d.updated_at<>r.draft_revision or d.approved_at is null or d.archived_at is not null or d.external_url is not null
    or jsonb_build_object('title',d.title,'body',d.body,'original_url',d.original_url,'image_paths',d.image_paths)<>r.snapshot then raise exception 'MERCHANT_DRAFT_CHANGED'; end if;
  if not exists(select 1 from private.merchant_naver_connections where merchant_id=r.merchant_id and user_id=auth.uid() and generation=r.connection_generation and expires_at>now()) then raise exception 'NAVER_RECONNECT_REQUIRED'; end if;
  perform private.assert_content_allowed(concat_ws(' ',d.title,d.body));
  if exists(select 1 from private.watch_terms w where w.active and position(regexp_replace(lower(w.term),'[[:space:][:punct:]]+','','g') in
    regexp_replace(lower(normalize(concat_ws(' ',d.title,d.body),NFKC)),'[[:space:][:punct:]]+','','g'))>0) then raise exception 'NAVER_CONTENT_REVIEW_REQUIRED'; end if;
  perform private.enforce_rate_limit('merchant-naver-publish',3,interval '1 day');
  update private.merchant_naver_requests set status='in_flight' where id=r.id returning * into r;
  return jsonb_build_object('should_send',true,'request',to_jsonb(r));
end;
$$;

create function public.cancel_merchant_naver_preparation(p_merchant_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.merchant_naver_requests;
begin
  perform private.assert_naver_merchant(p_merchant_id,auth.uid());
  select * into r from private.merchant_naver_requests where id=p_request_id and merchant_id=p_merchant_id and user_id=auth.uid() for update;
  if r.id is null then raise exception 'MERCHANT_REQUEST_CONFLICT'; end if;
  if r.status='prepared' then
    update private.merchant_naver_requests set status='failed',error_code='NAVER_PREPARATION_CANCELLED',completed_at=now() where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
end;
$$;

create function public.complete_merchant_naver_publish(p_request_id uuid,p_status text,p_article_url text,p_error_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.merchant_naver_requests;
begin
  select * into r from private.merchant_naver_requests where id=p_request_id for update;
  if r.id is null or r.status<>'in_flight' then raise exception 'MERCHANT_REQUEST_CONFLICT'; end if;
  if p_status not in ('succeeded','failed','uncertain') or p_status is null then raise exception 'INVALID_NAVER_RESULT'; end if;
  if p_status='succeeded' and (p_article_url is null or p_article_url !~ '^https://cafe\.naver\.com/[A-Za-z0-9_-]{1,100}/[1-9][0-9]*$') then raise exception 'INVALID_NAVER_RESULT'; end if;
  if p_status<>'succeeded' and p_article_url is not null then raise exception 'INVALID_NAVER_RESULT'; end if;
  -- Receipts remain recordable after revocation; this function cannot dispatch another provider request.
  update private.merchant_naver_requests set status=p_status,article_url=p_article_url,error_code=left(p_error_code,32),completed_at=now() where id=r.id returning * into r;
  if p_status='succeeded' then
    update private.merchant_workspace_drafts set external_url=p_article_url,updated_at=now()
      where id=r.draft_id and merchant_id=r.merchant_id and updated_at=r.draft_revision;
  end if;
  return to_jsonb(r);
end;
$$;

create function private.guard_naver_draft_in_flight() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.merchant_naver_requests where draft_id=old.id and status in ('in_flight','uncertain')) then raise exception 'NAVER_PUBLISH_UNCERTAIN'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_naver_draft_in_flight() from public,anon,authenticated,service_role;
create trigger merchant_naver_draft_guard before update or delete on private.merchant_workspace_drafts for each row execute function private.guard_naver_draft_in_flight();

create function private.erase_deleted_naver_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.account_status='deleted' and old.account_status is distinct from new.account_status then
    delete from private.merchant_naver_connections where user_id=new.id;
    delete from private.merchant_naver_states where user_id=new.id;
    delete from private.merchant_naver_requests where user_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.erase_deleted_naver_account() from public,anon,authenticated,service_role;
-- PostgreSQL orders same-event triggers by name; purge tokens/requests before workspace erasure.
create trigger merchant_naver_account_erasure after update of account_status on public.profiles for each row execute function private.erase_deleted_naver_account();

revoke all on function public.get_merchant_naver_cafe(uuid),public.begin_merchant_naver_oauth(uuid,text),public.disconnect_merchant_naver_cafe(uuid),
  public.reserve_merchant_naver_publish(uuid,uuid,timestamptz,uuid,text,text,text[]),public.claim_merchant_naver_publish(uuid),public.cancel_merchant_naver_preparation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_naver_cafe(uuid),public.begin_merchant_naver_oauth(uuid,text),public.disconnect_merchant_naver_cafe(uuid),
  public.reserve_merchant_naver_publish(uuid,uuid,timestamptz,uuid,text,text,text[]),public.claim_merchant_naver_publish(uuid),public.cancel_merchant_naver_preparation(uuid,uuid) to authenticated;
revoke all on function public.consume_merchant_naver_oauth(text,uuid),public.complete_merchant_naver_oauth(text,text,timestamptz),
  public.get_merchant_naver_tokens(uuid,uuid),public.refresh_merchant_naver_tokens(uuid,uuid,uuid,text,timestamptz),public.complete_merchant_naver_publish(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.consume_merchant_naver_oauth(text,uuid),public.complete_merchant_naver_oauth(text,text,timestamptz),
  public.get_merchant_naver_tokens(uuid,uuid),public.refresh_merchant_naver_tokens(uuid,uuid,uuid,text,timestamptz),public.complete_merchant_naver_publish(uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
