-- Company identity stays independent of personal accounts; operators receive content access only.
create table private.merchant_operators (
  merchant_id uuid not null references private.merchants(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), primary key(merchant_id,user_id)
);
create index merchant_operators_user_idx on private.merchant_operators(user_id,merchant_id);
create table private.merchant_account_invitations (
  id uuid primary key default gen_random_uuid(), merchant_id uuid not null references private.merchants(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check(role in ('owner','operator')), merchant_snapshot jsonb not null,
  note text not null check(length(btrim(note)) between 6 and 3000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz, revoked_at timestamptz,
  check(jsonb_typeof(merchant_snapshot)='object'), check(expires_at>created_at)
);
create index merchant_invitations_user_idx on private.merchant_account_invitations(user_id,expires_at) where accepted_at is null and revoked_at is null;
create unique index merchant_invitation_pending_idx on private.merchant_account_invitations(merchant_id,user_id,role) where accepted_at is null and revoked_at is null;
create table private.merchant_connection_audit (
  id bigint generated always as identity primary key, merchant_id uuid not null references private.merchants(id),
  actor_id uuid references public.profiles(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null check(role in ('owner','operator')), method text not null check(method in ('direct','invitation','disconnect','cancel')),
  before_state jsonb not null, after_state jsonb not null, note text not null,
  created_at timestamptz not null default now()
);
create index merchant_connection_audit_merchant_idx on private.merchant_connection_audit(merchant_id,created_at desc,id);
alter table private.merchant_operators enable row level security;
alter table private.merchant_account_invitations enable row level security;
alter table private.merchant_connection_audit enable row level security;
revoke all on private.merchant_operators,private.merchant_account_invitations,private.merchant_connection_audit from public,anon,authenticated,service_role;

create function private.merchant_connection_snapshot(m private.merchants) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('name',m.name,'address',m.address,'city_id',m.city_id,
    'owner_id',m.owner_id,'owner_verified_at',m.owner_verified_at);
$$;

create function public.get_merchant_account_connections(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; admin boolean:=private.is_admin();
begin
  m:=private.assert_merchant_workspace(p_merchant_id);
  return jsonb_build_object('merchant_id',m.id,'updated_at',m.updated_at,
    'owner',(select jsonb_build_object('user_id',p.id,'nickname',p.nickname,'email',case when admin then u.email end,'role','owner')
      from public.profiles p join auth.users u on u.id=p.id where p.id=m.owner_id),
    'operators',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'nickname',p.nickname,
      'email',case when admin then u.email end,'role','operator','created_at',o.created_at) order by p.nickname,p.id)
      from private.merchant_operators o join public.profiles p on p.id=o.user_id join auth.users u on u.id=p.id where o.merchant_id=m.id),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'user_id',p.id,'nickname',p.nickname,
      'email',case when admin then u.email end,'role',i.role,'expires_at',i.expires_at) order by i.created_at,i.id)
      from private.merchant_account_invitations i join public.profiles p on p.id=i.user_id join auth.users u on u.id=p.id
      where i.merchant_id=m.id and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb));
end;
$$;

-- Callers hold account -> company locks and validate the reviewed destination before entering.
create function private.apply_merchant_account_connection(p_merchant_id uuid,p_user_id uuid,p_role text,p_method text,p_note text,p_invitation_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants; previous jsonb;
begin
  select * into m from private.merchants where id=p_merchant_id for update;
  previous:=jsonb_build_object('owner_id',m.owner_id,'operator',exists(select 1 from private.merchant_operators where merchant_id=m.id and user_id=p_user_id));
  if p_role='owner' then
    if m.owner_id is not null then raise exception 'MERCHANT_OWNER_TRANSFER_REQUIRED'; end if;
    delete from private.merchant_operators where merchant_id=m.id;
    update private.merchants set owner_id=p_user_id,owner_verified_at=clock_timestamp(),updated_at=clock_timestamp() where id=m.id;
    update private.merchant_account_invitations set revoked_at=clock_timestamp()
      where merchant_id=m.id and accepted_at is null and revoked_at is null and id is distinct from p_invitation_id;
  elsif p_role='operator' then
    if m.owner_id is null or m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
    if m.owner_id=p_user_id then raise exception 'MERCHANT_ALREADY_CONNECTED'; end if;
    insert into private.merchant_operators(merchant_id,user_id,created_by) values(m.id,p_user_id,auth.uid())
      on conflict(merchant_id,user_id) do nothing;
    update private.merchants set updated_at=clock_timestamp() where id=m.id;
    update private.merchant_account_invitations set revoked_at=clock_timestamp()
      where merchant_id=m.id and user_id=p_user_id and role=p_role and accepted_at is null and revoked_at is null and id is distinct from p_invitation_id;
  else raise exception 'INVALID_MERCHANT_CONNECTION'; end if;
  update auth.users set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'),'{merchant_enabled}','true') where id=p_user_id;
  insert into private.merchant_connection_audit(merchant_id,actor_id,user_id,role,method,before_state,after_state,note)
    values(m.id,auth.uid(),p_user_id,p_role,p_method,previous,
      jsonb_build_object('owner_id',case when p_role='owner' then p_user_id else m.owner_id end,'operator',p_role='operator'),p_note);
  return m.id;
end;
$$;

create function public.connect_admin_merchant_account(p_merchant_id uuid,p_user_id uuid,p_role text,p_method text,p_verified boolean,p_note text,
  p_expected_updated_at timestamptz,p_expected_nickname text,p_expected_email text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants; account_name text; account_email text; invitation_id uuid;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if p_role is null or p_role not in ('owner','operator') or p_method is null or p_method not in ('direct','invite') then raise exception 'INVALID_MERCHANT_CONNECTION'; end if;
  if p_verified is distinct from true or p_note is null or length(btrim(p_note)) not between 6 and 3000 then raise exception 'MERCHANT_CONNECTION_CONFIRMATION_REQUIRED'; end if;
  perform 1 from public.profiles where id=p_user_id and account_status='active' for share;
  if not found then raise exception 'INVALID_MERCHANT_OWNER'; end if;
  perform 1 from auth.users where id=p_user_id for update;
  select p.nickname,u.email into account_name,account_email from public.profiles p join auth.users u on u.id=p.id where p.id=p_user_id;
  if p_expected_nickname is distinct from account_name or p_expected_email is distinct from account_email then raise exception 'MERCHANT_ACCOUNT_CHANGED'; end if;
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null then raise exception 'MERCHANT_NOT_FOUND'; end if;
  if p_expected_updated_at is null or m.updated_at<>p_expected_updated_at then raise exception 'MERCHANT_CONNECTION_CHANGED'; end if;
  if p_role='owner' and m.owner_id is not null then raise exception 'MERCHANT_OWNER_TRANSFER_REQUIRED'; end if;
  if p_role='operator' and (m.owner_id is null or m.owner_verified_at is null) then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if p_method='direct' then return private.apply_merchant_account_connection(m.id,p_user_id,p_role,'direct',btrim(p_note)); end if;
  update private.merchant_account_invitations set revoked_at=clock_timestamp()
    where merchant_id=m.id and accepted_at is null and revoked_at is null and (role='owner' and p_role='owner' or user_id=p_user_id and role=p_role);
  insert into private.merchant_account_invitations(merchant_id,user_id,role,merchant_snapshot,note,created_by)
    values(m.id,p_user_id,p_role,private.merchant_connection_snapshot(m),btrim(p_note),auth.uid()) returning id into invitation_id;
  return invitation_id;
end;
$$;

revoke all on function private.merchant_connection_snapshot(private.merchants),private.apply_merchant_account_connection(uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_merchant_account_connections(uuid),public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_account_connections(uuid),public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamptz,text,text) to authenticated;

create function private.lock_merchant_connection_account() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=auth.uid() and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') and not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
end;
$$;

create function private.assert_merchant_content_access(p_merchant_id uuid,p_advanced boolean default false,p_write boolean default false)
returns private.merchants language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform private.assert_merchant_access();
  if p_write then select * into m from private.merchants where id=p_merchant_id for update;
  else select * into m from private.merchants where id=p_merchant_id for share; end if;
  if m.id is null then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if private.is_admin() then perform public.log_admin_access('analytics');
  elsif m.owner_id is distinct from uid then
    perform 1 from private.merchant_operators where merchant_id=m.id and user_id=uid for share;
    if not found or m.owner_verified_at is null then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  end if;
  if p_advanced and private.merchant_workspace_plan(m.id)='basic' then raise exception 'MERCHANT_PLAN_REQUIRED'; end if;
  return m;
end;
$$;
create function private.assert_merchant_content_write(p_merchant_id uuid,p_advanced boolean default false)
returns private.merchants language plpgsql security definer set search_path='' as $$
begin return private.assert_merchant_content_access(p_merchant_id,p_advanced,true); end;
$$;

create or replace function public.get_my_merchants() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_access();
  if private.is_admin() then perform public.log_admin_access('analytics'); end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from (
    select m.id,m.name,m.city_id,c.name city_name,
      case when m.owner_id=auth.uid() or private.is_admin() then m.contact else '' end contact,
      m.status,m.owner_id,m.owner_verified_at,m.trial_ends_at,m.workspace_until,
      (now() at time zone c.timezone)::date today,private.merchant_workspace_plan(m.id) plan,
      case when private.is_admin() then 'admin' when m.owner_id=auth.uid() then 'owner' else 'operator' end role
    from private.merchants m join public.cities c on c.id=m.city_id
    where m.owner_id=auth.uid() or private.is_admin()
      or m.owner_verified_at is not null and exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=auth.uid())
    order by m.name,m.id limit 50)x),'[]'::jsonb);
end;
$$;

create function public.get_my_merchant_connections() returns jsonb
language plpgsql security definer set search_path='' as $$
declare merchants jsonb:='[]';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if public.get_my_merchant_access() then
    select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','name',x->>'name','city_name',x->>'city_name','role',x->>'role')),'[]'::jsonb)
      into merchants from jsonb_array_elements(public.get_my_merchants()) x;
  end if;
  return jsonb_build_object('user_id',auth.uid(),'merchants',merchants,
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'merchant_id',i.merchant_id,
      'merchant_name',i.merchant_snapshot->>'name','address',i.merchant_snapshot->>'address','city_name',c.name,
      'role',i.role,'expires_at',i.expires_at,'can_accept',i.merchant_snapshot=private.merchant_connection_snapshot(m)
        and exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=i.created_by and u.raw_app_meta_data->>'role'='admin' and p.account_status='active'))
      order by i.created_at,i.id)
      from private.merchant_account_invitations i join private.merchants m on m.id=i.merchant_id
        join public.cities c on c.id=i.merchant_snapshot->>'city_id'
      where i.user_id=auth.uid() and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb));
end;
$$;

create function public.accept_merchant_account_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare i private.merchant_account_invitations; m private.merchants;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into i from private.merchant_account_invitations where id=p_invitation_id and user_id=auth.uid();
  if i.id is null then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  perform 1 from public.profiles where id in (auth.uid(),i.created_by) order by id for share;
  perform 1 from auth.users where id in (auth.uid(),i.created_by) order by id for update;
  perform private.lock_merchant_connection_account();
  select * into m from private.merchants where id=i.merchant_id for update;
  select * into i from private.merchant_account_invitations where id=p_invitation_id for update;
  if i.user_id is distinct from auth.uid() or i.accepted_at is not null or i.revoked_at is not null or i.expires_at<=now()
    or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
      where u.id=i.created_by and u.raw_app_meta_data->>'role'='admin' and p.account_status='active') then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  if i.merchant_snapshot is distinct from private.merchant_connection_snapshot(m) then raise exception 'MERCHANT_CONNECTION_CHANGED'; end if;
  perform private.apply_merchant_account_connection(m.id,auth.uid(),i.role,'invitation',i.note,i.id);
  update private.merchant_account_invitations set accepted_at=clock_timestamp() where id=i.id;
  return m.id;
end;
$$;

create function public.disconnect_merchant_account(p_merchant_id uuid,p_user_id uuid,p_role text,p_expected_updated_at timestamptz,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants; previous jsonb;
begin
  perform private.lock_merchant_connection_account();
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null or (not private.is_admin() and m.owner_id is distinct from auth.uid() and auth.uid() is distinct from p_user_id)
    then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if p_role is null or p_role not in ('owner','operator') or p_note is null or length(btrim(p_note)) not between 6 and 3000 then raise exception 'INVALID_MERCHANT_CONNECTION'; end if;
  if p_expected_updated_at is null or m.updated_at<>p_expected_updated_at then raise exception 'MERCHANT_CONNECTION_CHANGED'; end if;
  previous:=jsonb_build_object('owner_id',m.owner_id,'operator',exists(select 1 from private.merchant_operators where merchant_id=m.id and user_id=p_user_id));
  if p_role='owner' then
    if m.owner_id is distinct from p_user_id or (not private.is_admin() and auth.uid() is distinct from p_user_id) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
    delete from private.merchant_operators where merchant_id=m.id;
    update private.merchants set owner_id=null,owner_verified_at=null,updated_at=clock_timestamp() where id=m.id;
    update private.merchant_account_invitations set revoked_at=clock_timestamp()
      where merchant_id=m.id and accepted_at is null and revoked_at is null;
  else
    delete from private.merchant_operators where merchant_id=m.id and user_id=p_user_id;
    if not found then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
    update private.merchants set updated_at=clock_timestamp() where id=m.id;
    update private.merchant_account_invitations set revoked_at=clock_timestamp()
      where merchant_id=m.id and user_id=p_user_id and role='operator' and accepted_at is null and revoked_at is null;
  end if;
  if private.is_admin() then perform public.log_admin_access('analytics'); end if;
  insert into private.merchant_connection_audit(merchant_id,actor_id,user_id,role,method,before_state,after_state,note)
    values(m.id,auth.uid(),p_user_id,p_role,'disconnect',previous,
      jsonb_build_object('owner_id',case when p_role='owner' then null else m.owner_id end,'operator',false),btrim(p_note));
  return m.id;
end;
$$;

create function public.cancel_merchant_account_invitation(p_invitation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare i private.merchant_account_invitations; m private.merchants;
begin
  perform private.lock_merchant_connection_account();
  select * into i from private.merchant_account_invitations where id=p_invitation_id;
  if i.id is null then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  select * into m from private.merchants where id=i.merchant_id for update;
  if not private.is_admin() and i.user_id<>auth.uid() and m.owner_id is distinct from auth.uid() then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  update private.merchant_account_invitations set revoked_at=clock_timestamp()
    where id=i.id and accepted_at is null and revoked_at is null;
  if not found then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  if private.is_admin() then perform public.log_admin_access('analytics'); end if;
  insert into private.merchant_connection_audit(merchant_id,actor_id,user_id,role,method,before_state,after_state,note)
    values(m.id,auth.uid(),i.user_id,i.role,'cancel',jsonb_build_object('invitation_id',i.id,'pending',true),
      jsonb_build_object('invitation_id',i.id,'pending',false),'초대 취소');
  return m.id;
end;
$$;

revoke all on function private.lock_merchant_connection_account(),private.assert_merchant_content_access(uuid,boolean,boolean),private.assert_merchant_content_write(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_my_merchant_connections(),public.accept_merchant_account_invitation(uuid),public.disconnect_merchant_account(uuid,uuid,text,timestamptz,text),public.cancel_merchant_account_invitation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_merchant_connections(),public.accept_merchant_account_invitation(uuid),public.disconnect_merchant_account(uuid,uuid,text,timestamptz,text),public.cancel_merchant_account_invitation(uuid) to authenticated;

create or replace function private.assert_merchant_workspace(p_merchant_id uuid,p_advanced boolean default false)
returns private.merchants language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform private.assert_merchant_access();
  if private.is_admin() then perform public.log_admin_access('analytics'); end if;
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null or (not private.is_admin() and m.owner_id is distinct from uid) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if p_advanced and private.merchant_workspace_plan(m.id)='basic' then raise exception 'MERCHANT_PLAN_REQUIRED'; end if;
  return m;
end;
$$;

create or replace function public.get_merchant_workspace(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; merchant jsonb; today date; data jsonb; full_access boolean;
begin
  m:=private.assert_merchant_content_access(p_merchant_id);
  full_access:=m.owner_id=auth.uid() or private.is_admin();
  select (now() at time zone c.timezone)::date,jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id,
    'city_name',c.name,'contact',case when full_access then m.contact else '' end,'status',m.status,
    'owner_id',m.owner_id,'owner_verified_at',m.owner_verified_at,'trial_ends_at',m.trial_ends_at,'workspace_until',m.workspace_until,
    'today',(now() at time zone c.timezone)::date,'plan',private.merchant_workspace_plan(m.id),
    'role',case when private.is_admin() then 'admin' when m.owner_id=auth.uid() then 'owner' else 'operator' end) into today,merchant
    from public.cities c where c.id=m.city_id;
  if full_access then data:=private.merchant_period_data(m.id,today-13,today);
  else
    data:=jsonb_build_object('metrics',null,'posts',coalesce((select jsonb_agg(jsonb_build_object(
      'post_id',p.id,'title',p.title,'original_url',mp.original_url,'displayed_views',p.view_count,'source_clicks',null,'status',p.status,'created_at',p.created_at) order by p.created_at desc,p.id)
      from private.merchant_posts mp join public.posts p on p.id=mp.post_id where mp.merchant_id=m.id),'[]'::jsonb));
  end if;
  return data||jsonb_build_object('merchant',merchant,'can_manage_business',full_access,
    'can_edit_content',private.is_admin() or m.owner_verified_at is not null,
    'items',case when full_access then coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.id) from
      (select id,name,unit,unit_cost,quantity,low_stock,updated_at from private.merchant_items where merchant_id=m.id order by name,id limit 500)x),'[]'::jsonb) else '[]'::jsonb end,
    'drafts',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id) from
      (select id,channel,title,body,original_url,tag_slug,kind,approved_at,post_id,published_at,external_url,archived_at,updated_at,image_paths
        from private.merchant_workspace_drafts where merchant_id=m.id order by updated_at desc,id limit 100)x),'[]'::jsonb),
    'movements',case when full_access then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from
      (select s.id,s.item_id,i.name item_name,s.delta,s.note,s.created_at from private.merchant_stock_movements s
        join private.merchant_items i on i.id=s.item_id where s.merchant_id=m.id order by s.created_at desc,s.id limit 100)x),'[]'::jsonb) else '[]'::jsonb end,
    'reports',case when full_access then coalesce((select jsonb_agg(to_jsonb(x) order by x.generated_at desc,x.id) from
      (select * from private.merchant_reports where merchant_id=m.id order by generated_at desc,id limit 12)x),'[]'::jsonb) else '[]'::jsonb end);
end;
$$;

create or replace function public.get_my_merchant_profile(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  m:=private.assert_merchant_content_access(p_merchant_id);
  return jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id,
    'city_name',(select name from public.cities where id=m.city_id),'industry',m.industry,'services',m.services,'address',m.address,
    'avatar_path',m.avatar_path,'banner_path',m.banner_path,'review_post_id',public.get_merchant_profile(m.id)->'review_post_id',
    'updated_at',m.updated_at,'can_edit',private.is_admin() or m.owner_verified_at is not null);
end;
$$;
create or replace function private.lock_merchant_profile_owner(p_merchant_id uuid,p_write boolean default false) returns private.merchants
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  m:=private.assert_merchant_content_access(p_merchant_id,false,p_write);
  if not private.is_admin() and m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  return m;
end;
$$;

-- Preserve the installed publishing revisions, quotas, photo limits and safety checks.
do $$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array[
    'public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text,text[])',
    'public.approve_merchant_workspace_drafts(uuid,uuid[],boolean,jsonb)',
    'public.publish_merchant_workspace_draft(uuid,uuid,timestamp with time zone)',
    'public.record_merchant_external_post(uuid,uuid,text,timestamp with time zone)',
    'public.archive_merchant_workspace_drafts(uuid,uuid[],boolean)',
    'public.edit_merchant_post(uuid,uuid,text,text,text[])','public.remove_merchant_post(uuid,uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('private.assert_merchant_workspace(' in definition)=0 then raise exception 'merchant content permission anchor changed: %',signature; end if;
    execute replace(definition,'private.assert_merchant_workspace(','private.assert_merchant_content_write(');
  end loop;
  definition:=pg_get_functiondef('public.set_admin_merchant_workspace_owner(uuid,uuid,boolean,date)'::regprocedure);
  anchor:='if m.owner_id is not null and m.owner_id<>p_owner_id then';
  if position(anchor in definition)=0 then raise exception 'merchant owner confirmation anchor changed'; end if;
  execute replace(definition,anchor,'if m.owner_id is null then raise exception ''MERCHANT_CONNECTION_CONFIRMATION_REQUIRED''; end if; '||anchor);
  definition:=pg_get_functiondef('public.set_admin_merchant_access(uuid,boolean)'::regprocedure);
  anchor:='perform public.log_admin_access(''users'',p_user_id,null);';
  if position(anchor in definition)=0 then raise exception 'merchant capability revocation anchor changed'; end if;
  execute replace(definition,anchor,'if not p_enabled then update private.merchant_account_invitations set revoked_at=clock_timestamp() where user_id=p_user_id and accepted_at is null and revoked_at is null; end if; '||anchor);
  definition:=pg_get_functiondef('public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamp with time zone,text,text)'::regprocedure);
  anchor:='perform public.log_admin_access(''analytics'');';
  execute replace(definition,anchor,
    'perform 1 from public.profiles where id in (auth.uid(),p_user_id) order by id for share; '
    ||'perform 1 from auth.users where id in (auth.uid(),p_user_id) order by id for update; '
    ||'if not private.is_admin() then raise exception ''ADMIN_REQUIRED''; end if; '||anchor);
end;
$$;

create index merchant_draft_image_paths_idx on private.merchant_workspace_drafts using gin(image_paths);
-- Keep one publishing implementation; only the private caller can supply proven retained photos.
do $migration$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  definition:=replace(definition,'FUNCTION public.create_post(','FUNCTION private.create_merchant_content_post(');
  anchor:='p_price numeric DEFAULT NULL::numeric)';
  if position(anchor in definition)=0 then raise exception 'create post signature changed'; end if;
  definition:=replace(definition,anchor,'p_price numeric DEFAULT NULL::numeric, p_retained_paths text[] DEFAULT ''{}''::text[])');
  anchor:='where path not like current_user_id::text || ''/%''';
  if position(anchor in definition)=0 then raise exception 'create post photo guard changed'; end if;
  execute replace(definition,anchor,anchor||' and not (path=any(coalesce(p_retained_paths,''{}'')))');

  definition:=pg_get_functiondef('public.publish_merchant_workspace_draft(uuid,uuid,timestamptz)'::regprocedure);
  anchor:='m:=private.assert_merchant_content_write(p_merchant_id);';
  if position(anchor in definition)=0 or position('p_image_paths=>d.image_paths' in definition)=0 then raise exception 'merchant publishing anchor changed'; end if;
  definition:=replace(definition,anchor,'perform private.lock_relationships(); perform 1 from public.profiles where id=auth.uid() for update; '||anchor);
  definition:=replace(definition,'public.create_post(','private.create_merchant_content_post(');
  execute replace(definition,'p_image_paths=>d.image_paths','p_image_paths=>d.image_paths,p_retained_paths=>d.image_paths');
  definition:=pg_get_functiondef('public.remove_merchant_post(uuid,uuid)'::regprocedure);
  execute replace(definition,'m:=private.assert_merchant_content_write(p_merchant_id);',
    'perform private.lock_relationships(); perform 1 from public.profiles where id=auth.uid() for update; m:=private.assert_merchant_content_write(p_merchant_id);');
  definition:=pg_get_functiondef('public.save_merchant_workspace_draft(uuid,uuid,text,text,text,text,text,text,text[])'::regprocedure);
  anchor:='perform private.assert_merchant_image_paths(p_image_paths);';
  if position(anchor in definition)=0 then raise exception 'merchant draft photo guard changed'; end if;
  execute replace(definition,anchor,
    'perform 1 from private.merchant_workspace_drafts where id=p_id and merchant_id=p_merchant_id for update; '
    ||'perform private.assert_merchant_image_paths(p_image_paths,coalesce((select image_paths from private.merchant_workspace_drafts where id=p_id and merchant_id=p_merchant_id),''{}''));');
  definition:=pg_get_functiondef('private.can_read_merchant_profile_image(text)'::regprocedure);
  execute replace(definition,'private.assert_merchant_workspace(mid)','private.assert_merchant_content_access(mid)');
end;
$migration$;
alter function private.create_merchant_content_post(text,smallint,text,text,text[],text[],jsonb,text,numeric,text[]) owner to postgres;
revoke all on function private.create_merchant_content_post(text,smallint,text,text,text[],text[],jsonb,text,numeric,text[]) from public,anon,authenticated,service_role;
create or replace function public.create_post(p_city_id text,p_tag_id smallint,p_title text,p_body text,
  p_hashtags text[] default '{}',p_image_paths text[] default '{}',p_room_preview jsonb default null,p_kind text default 'story',p_price numeric default null)
returns uuid language sql security definer set search_path='' as $$
  select private.create_merchant_content_post(p_city_id,p_tag_id,p_title,p_body,p_hashtags,p_image_paths,p_room_preview,p_kind,p_price,'{}');
$$;

create function private.assert_merchant_post_content_access(p_post_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare mid uuid; m private.merchants;
begin
  select merchant_id into mid from private.merchant_posts where post_id=p_post_id;
  if mid is null then return; end if;
  perform private.lock_relationships();
  perform 1 from public.profiles where id=auth.uid() for update;
  m:=private.assert_merchant_content_write(mid);
  if not private.is_admin() and m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
end;
$$;
create function public.can_modify_merchant_post(p_post_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_merchant_post_content_access(p_post_id);
  return true;
exception when sqlstate 'P0001' then return false;
end;
$$;
revoke all on function private.assert_merchant_post_content_access(uuid),public.can_modify_merchant_post(uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_modify_merchant_post(uuid) to authenticated;
alter policy "users update own posts" on public.posts to authenticated
  using(author_id=(select auth.uid()) and private.is_active_account((select auth.uid())) and public.can_modify_merchant_post(id))
  with check(author_id=(select auth.uid()) and private.is_active_account((select auth.uid())) and public.can_modify_merchant_post(id));
create function private.guard_merchant_post_images() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated' and exists(select 1 from private.merchant_posts where post_id=old.id) and new.image_paths is distinct from old.image_paths then
    perform private.assert_merchant_image_paths(new.image_paths,old.image_paths);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_merchant_post_images() from public,anon,authenticated,service_role;
create trigger merchant_post_images_guard before update of image_paths on public.posts
  for each row execute function private.guard_merchant_post_images();
do $$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array['public.bump_post(uuid)','public.set_listing_status(uuid,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='select * into p from public.posts where id = p_post_id for update;';
    if position(anchor in definition)=0 then raise exception 'listing authorization anchor changed'; end if;
    execute replace(definition,anchor,'perform private.lock_relationships(); perform private.assert_merchant_post_content_access(p_post_id); '||anchor);
  end loop;
end;
$$;
create or replace function public.is_public_post_image(image_path text) returns boolean
language sql stable strict security definer set search_path='' as $$
  select exists(select 1 from public.posts p join public.profiles a on a.id=p.author_id and a.account_status='active'
    where p.status='published' and p.image_paths @> array[image_path]
      and (split_part(image_path,'/',1)=p.author_id::text or exists(select 1 from private.merchant_posts where post_id=p.id)));
$$;
create function public.is_merchant_post_image_bound(p_path text) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from private.merchant_workspace_drafts where image_paths @> array[p_path])
    or exists(select 1 from private.merchant_posts m join public.posts p on p.id=m.post_id where p.image_paths @> array[p_path]);
$$;
revoke all on function public.is_merchant_post_image_bound(text) from public,anon,authenticated,service_role;
grant execute on function public.is_merchant_post_image_bound(text) to authenticated;
alter policy "users update own image objects" on storage.objects
  using(bucket_id in ('avatars','post-images') and owner_id=(select auth.uid())::text
    and private.is_active_account((select auth.uid())) and (bucket_id<>'post-images' or not public.is_merchant_post_image_bound(name)))
  with check(bucket_id in ('avatars','post-images') and (storage.foldername(name))[1]=(select auth.uid())::text
    and private.is_active_account((select auth.uid())) and (bucket_id<>'post-images' or not public.is_merchant_post_image_bound(name)));
alter policy "users upload to own image folder" on storage.objects
  with check(bucket_id in ('avatars','post-images') and (storage.foldername(name))[1]=(select auth.uid())::text
    and private.is_active_account((select auth.uid())) and (bucket_id<>'post-images' or not public.is_merchant_post_image_bound(name)));
alter policy "users delete own image objects" on storage.objects
  using(bucket_id in ('avatars','post-images') and owner_id=(select auth.uid())::text
    and private.is_active_account((select auth.uid())) and (bucket_id<>'post-images' or not public.is_merchant_post_image_bound(name)));
-- Outer MCP callers must enter the established publishing lock order before shared account locks.
do $$
declare signature text; definition text; anchor text:='perform private.assert_mcp_web_user();'; prefix text;
begin
  foreach signature in array array['public.dispatch_merchant_mcp(uuid,uuid,uuid,uuid,text,jsonb)','public.review_merchant_mcp_change(uuid,boolean)'] loop
    if to_regprocedure(signature) is null then raise exception 'required MCP migration missing: %',signature; end if;
    definition:=pg_get_functiondef(signature::regprocedure);
    prefix:='perform private.lock_relationships(); perform 1 from public.profiles where id=auth.uid() for update; ';
    if signature like '%dispatch_%' then prefix:='if p_tool=''publish_business_draft'' then '||prefix||'end if; '; end if;
    if position(anchor in definition)=0 then raise exception 'MCP account lock anchor changed'; end if;
    execute replace(definition,anchor,prefix||anchor);
  end loop;
end;
$$;
create function public.account_image_cleanup_paths(p_user_id uuid,p_bucket text,p_paths text[]) returns text[]
language plpgsql security definer set search_path='' as $$
declare path text; bound boolean; deletable text[]:='{}';
begin
  if p_user_id is null or p_bucket is null or p_bucket not in ('avatars','post-images','chat-images','merchant-review-receipts','merchant-profile-images')
    or p_paths is null or cardinality(p_paths)>100 or exists(select 1 from unnest(p_paths) x where x is null or split_part(x,'/',1)<>p_user_id::text)
    then raise exception 'INVALID_ACCOUNT_IMAGE_CLEANUP'; end if;
  foreach path in array p_paths loop
    bound:=false;
    if p_bucket='post-images' then
      bound:=exists(select 1 from private.merchant_workspace_drafts d join private.merchants m on m.id=d.merchant_id
        where d.image_paths @> array[path] and m.owner_id is distinct from p_user_id)
        or exists(select 1 from private.merchant_posts mp join private.merchants m on m.id=mp.merchant_id join public.posts p on p.id=mp.post_id
          where p.image_paths @> array[path] and m.owner_id is distinct from p_user_id);
    elsif p_bucket='merchant-profile-images' then
      perform pg_advisory_xact_lock(hashtextextended(path,1314));
      bound:=exists(select 1 from private.merchants where (avatar_path=path or banner_path=path) and owner_id is distinct from p_user_id);
    end if;
    if bound then
      update storage.objects set owner=null,owner_id=null where bucket_id=p_bucket and name=path;
    else deletable:=array_append(deletable,path); end if;
  end loop;
  return deletable;
end;
$$;
revoke all on function public.account_image_cleanup_paths(uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.account_image_cleanup_paths(uuid,text,text[]) to service_role;
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.erase_deleted_merchant_channel_images()'::regprocedure);
  anchor:='where (owner_id=new.id and (avatar_path is not null or banner_path is not null))'||chr(10)
    ||'      or split_part(avatar_path,''/'',1)=new.id::text or split_part(banner_path,''/'',1)=new.id::text';
  if position(anchor in definition)=0 then raise exception 'company image erasure anchor changed'; end if;
  execute replace(definition,anchor,'where owner_id=new.id and (avatar_path is not null or banner_path is not null)');
  definition:=pg_get_functiondef('private.erase_deleted_merchant_workspace()'::regprocedure);
  anchor:='set owner_id=null,owner_verified_at=null,workspace_until=null';
  if position(anchor in definition)=0 then raise exception 'owned company erasure anchor changed'; end if;
  definition:=replace(definition,'for mid in select id from private.merchants where owner_id=new.id loop','for mid in select id from private.merchants where owner_id=new.id order by id for update loop');
  execute replace(definition,anchor,'set avatar_path=null,banner_path=null,owner_id=null,owner_verified_at=null,workspace_until=null');
  definition:=pg_get_functiondef('private.assert_merchant_profile_image(text,uuid,text)'::regprocedure);
  anchor:='(o.owner_id=uploader::text or o.owner=uploader)';
  if position(anchor in definition)=0 then raise exception 'retained company profile image anchor changed'; end if;
  execute replace(definition,anchor,'(o.owner_id=uploader::text or o.owner=uploader or p_path=p_retained)');
end;
$$;
create function public.can_read_merchant_post_image(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  if auth.uid() is null or not private.is_active_account(auth.uid()) then return false; end if;
  if public.is_public_post_image(p_path) then return true; end if;
  if private.is_admin() then perform public.log_admin_access('posts'); return true; end if;
  if exists(select 1 from private.merchant_workspace_drafts where image_paths @> array[p_path]) then
    for mid in select merchant_id from private.merchant_workspace_drafts where image_paths @> array[p_path] loop
      begin perform private.assert_merchant_content_access(mid); return true;
      exception when others then null; end;
    end loop;
    return false;
  end if;
  return split_part(p_path,'/',1)=auth.uid()::text;
end;
$$;
revoke all on function public.can_read_merchant_post_image(text) from public,anon,authenticated,service_role;
grant execute on function public.can_read_merchant_post_image(text) to authenticated;
alter policy "authenticated users read app images" on storage.objects to authenticated
  using(bucket_id='avatars' or bucket_id='post-images' and public.can_read_merchant_post_image(name));
-- Existing SECURITY DEFINER routines run as postgres even when an admin applies the migration.
alter table private.merchant_operators owner to postgres;
alter table private.merchant_account_invitations owner to postgres;
alter table private.merchant_connection_audit owner to postgres;
do $$
declare signature text;
begin
  foreach signature in array array[
    'private.merchant_connection_snapshot(private.merchants)',
    'private.apply_merchant_account_connection(uuid,uuid,text,text,text,uuid)',
    'private.lock_merchant_connection_account()',
    'private.assert_merchant_content_access(uuid,boolean,boolean)','private.assert_merchant_content_write(uuid,boolean)',
    'public.get_merchant_account_connections(uuid)',
    'public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamp with time zone,text,text)',
    'public.get_my_merchant_connections()','public.accept_merchant_account_invitation(uuid)',
    'public.disconnect_merchant_account(uuid,uuid,text,timestamp with time zone,text)',
    'public.cancel_merchant_account_invitation(uuid)','public.can_read_merchant_post_image(text)',
    'private.assert_merchant_post_content_access(uuid)','public.can_modify_merchant_post(uuid)',
    'private.guard_merchant_post_images()','public.is_merchant_post_image_bound(text)',
    'public.account_image_cleanup_paths(uuid,text,text[])'
  ] loop execute 'alter function '||signature||' owner to postgres'; end loop;
end;
$$;
notify pgrst,'reload schema';
