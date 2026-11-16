-- Members the operator lets post without the personal posting caps: the active-listing limit and the
-- 10-posts-per-10-minutes guard. Meetup, AI-draft and business limits are unchanged.
-- Rows are written only by the operator with a direct database command; no API role can read or change them.
create table private.unlimited_posters(
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text check (note is null or length(note)<=500),
  created_at timestamptz not null default now()
);
alter table private.unlimited_posters owner to postgres;
revoke all on private.unlimited_posters from public,anon,authenticated,service_role;

do $$
declare definition text:=pg_get_functiondef('private.listing_limit(uuid)'::regprocedure);
  anchor text:=$a$select case private.membership_details(p_user_id)->>'tier' when 'admin' then 1000 when 'premium' then 20 when 'pro' then 20 when 'plus' then 10 else 5 end;$a$;
begin
  if position(anchor in definition)=0 then raise exception 'LISTING_LIMIT_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,
    $r$select case when exists(select 1 from private.unlimited_posters o where o.user_id=p_user_id) then 1000
    else case private.membership_details(p_user_id)->>'tier' when 'admin' then 1000 when 'premium' then 20 when 'pro' then 20 when 'plus' then 10 else 5 end end;$r$);
end;
$$;

do $$
declare definition text:=pg_get_functiondef('private.enforce_rate_limit(text,integer,interval,interval)'::regprocedure);
  anchor text:='if private.is_admin_id(current_user_id) then return; end if;';
begin
  if position(anchor in definition)=0 then raise exception 'RATE_LIMIT_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n  if p_action=''story_post'' and exists(select 1 from private.unlimited_posters where user_id=current_user_id) then return; end if;');
end;
$$;
