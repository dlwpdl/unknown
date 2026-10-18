-- A verified public business profile does not depend on publishing its first post.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.business_base_get_merchant_profile(uuid)'::regprocedure);
  anchor:='  join lateral (';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_PROFILE_POST_JOIN_CHANGED'; end if;
  definition:=replace(definition,anchor,'  left join lateral (');

  anchor:='where m.id=p_merchant_id;';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_PROFILE_VISIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,$guard$where m.id=p_merchant_id
    and (visible.post_id is not null or (
      m.owner_verified_at is not null and private.is_active_account(m.owner_id)
      and exists(select 1 from auth.users u where u.id=m.owner_id and u.raw_app_meta_data->'merchant_enabled'='true'::jsonb)
      and not private.is_blocked_between(auth.uid(),m.owner_id)
      and not private.has_reported(auth.uid(),'user',m.owner_id)));
  $guard$);
end $$;
notify pgrst,'reload schema';
