-- A per-member exception to the marketplace listing limit, set by the operator for individual accounts.
-- Rows are written only by the operator with a direct database command; no API role can read or change them.
create table private.listing_limit_overrides(
  user_id uuid primary key references auth.users(id) on delete cascade,
  listing_limit integer not null check (listing_limit between 1 and 1000),
  note text check (note is null or length(note)<=500),
  created_at timestamptz not null default now()
);
alter table private.listing_limit_overrides owner to postgres;
revoke all on private.listing_limit_overrides from public,anon,authenticated,service_role;

do $$
declare definition text:=pg_get_functiondef('private.listing_limit(uuid)'::regprocedure);
  anchor text:=$a$select case private.membership_details(p_user_id)->>'tier' when 'admin' then 1000 when 'premium' then 20 when 'pro' then 20 when 'plus' then 10 else 5 end;$a$;
begin
  if position(anchor in definition)=0 then raise exception 'LISTING_LIMIT_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,
    $r$select coalesce((select o.listing_limit from private.listing_limit_overrides o where o.user_id=p_user_id),
    case private.membership_details(p_user_id)->>'tier' when 'admin' then 1000 when 'premium' then 20 when 'pro' then 20 when 'plus' then 10 else 5 end);$r$);
end;
$$;
