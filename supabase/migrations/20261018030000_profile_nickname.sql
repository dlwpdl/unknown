-- Personal nicknames stay independent from business names and ownership.
create function public.change_profile_nickname(p_user_id uuid,p_nickname text,p_expected_nickname text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.profiles; name text:=btrim(p_nickname);
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is null or name is null or char_length(name) not between 2 and 20 or name ~ '[[:cntrl:]]' or p_expected_nickname is null then raise exception 'INVALID_NICKNAME'; end if;
  if actor<>p_user_id and not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  -- Match the established account-link lock order, including the live actor profile.
  perform 1 from public.profiles where id in (actor,p_user_id) order by id for update;
  select * into target from public.profiles where id=p_user_id;
  perform 1 from auth.users where id=actor for share;
  perform 1 from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id' for share;
  if not found then raise exception 'AUTH_REQUIRED'; end if;
  -- Row-lock waits must not extend a revoked or expired elevated session.
  if not exists(select 1 from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id'
    and (not_after is null or not_after>clock_timestamp())) then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(actor);
  if actor<>p_user_id and not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if target.id is null or target.account_status<>'active' then raise exception 'ACCOUNT_LOCKED'; end if;
  if target.nickname::text=name then return jsonb_build_object('id',target.id,'nickname',name); end if;
  if target.nickname::text is distinct from p_expected_nickname then raise exception 'NICKNAME_CHANGED'; end if;
  update public.profiles set nickname=name where id=target.id;
  if private.is_admin() then perform public.log_admin_access('users',target.id,null); end if;
  return jsonb_build_object('id',target.id,'nickname',name);
exception when unique_violation then raise exception 'NICKNAME_TAKEN';
end $$;
alter function public.change_profile_nickname(uuid,text,text) owner to postgres;
revoke all on function public.change_profile_nickname(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.change_profile_nickname(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
