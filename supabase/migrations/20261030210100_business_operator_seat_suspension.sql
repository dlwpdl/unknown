-- Security audit 2026-10-30: business co-managers kept their access after the business moved to a plan with fewer
-- seats (plus 1 / pro 2 / premium 5 / free 0). Like meetup co-hosts (private.meetup_tool_cohost), only the first
-- N seat holders by join time act; the rest are suspended, not removed, and come back when the seats do.
-- Seats are what the owner's invite link (20261025230000) sells, so only co-managers who joined through it hold one.
-- Co-managers an admin connected or invited were never seat-limited (admin connections skip the seat check) and keep
-- their access. The owner's access never depends on this. New invitations still count every co-manager, so an
-- upgrade restores suspended ones before anyone new can join.
create function private.merchant_operator_active(p_merchant_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  with seat_holders as(
    select o.user_id,o.created_at from private.merchant_operators o
    where o.merchant_id=p_merchant_id
      and exists(select 1 from private.merchant_operator_links l where l.merchant_id=o.merchant_id and l.used_by=o.user_id))
  select exists(select 1 from private.merchant_operators o where o.merchant_id=p_merchant_id and o.user_id=p_user_id
    and (not exists(select 1 from seat_holders s where s.user_id=o.user_id)
      or (select count(*) from seat_holders s where (s.created_at,s.user_id)<=(o.created_at,o.user_id))
        <=private.business_operator_limit(p_merchant_id)));
$$;
alter function private.merchant_operator_active(uuid,uuid) owner to postgres;
revoke all on function private.merchant_operator_active(uuid,uuid) from public,anon,authenticated,service_role;

-- Every check that grants a co-manager business powers goes through the seat rank. Listing, invitation seat counts,
-- chat row locks, disconnecting and the self-invite reward guard keep reading every co-manager on purpose.
do $$
declare r record; d text; operator_exists text:='exists\(select 1 from private\.merchant_operators o\s+where o\.merchant_id=m\.id and o\.user_id=';
begin
  for r in select * from (values
    ('private.assert_merchant_content_access(uuid,boolean,boolean)',
      'if not found or m\.owner_verified_at is null then raise exception ''MERCHANT_ACCESS_REQUIRED''',
      'if not found or m.owner_verified_at is null or not private.merchant_operator_active(m.id,uid) then raise exception ''MERCHANT_ACCESS_REQUIRED'''),
    ('private.business_chat_can_use(uuid,uuid)',operator_exists||'p_user\)','private.merchant_operator_active(m.id,p_user)'),
    ('private.merchant_review_visible_to(uuid,uuid)',operator_exists||'p_viewer\)','private.merchant_operator_active(m.id,p_viewer)'),
    ('public.business_paid_features(uuid)',operator_exists||'auth\.uid\(\)\)','private.merchant_operator_active(m.id,auth.uid())'),
    ('public.get_my_merchants()',operator_exists||'auth\.uid\(\)\)','private.merchant_operator_active(m.id,auth.uid())'),
    ('public.get_my_business_workspace_access()',operator_exists||'uid\)','private.merchant_operator_active(m.id,uid)'),
    -- The owner sees who is paused instead of a silent loss of access.
    ('public.get_merchant_account_connections(uuid)','''created_at'',o\.created_at\)',
      '''created_at'',o.created_at,''suspended'',not private.merchant_operator_active(m.id,o.user_id))')
  ) v(fn,pattern,replacement) loop
    d:=pg_get_functiondef(r.fn::regprocedure);
    if regexp_count(d,r.pattern)<>1 then raise exception 'OPERATOR_SEAT_ANCHOR_CHANGED %',r.fn; end if;
    execute regexp_replace(d,r.pattern,r.replacement);
  end loop;
end;
$$;
