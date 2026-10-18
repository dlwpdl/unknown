-- Chat identity selection depends on actual membership, independent of admin review access.
create function public.get_my_business_chat_profiles() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  return jsonb_build_object('user_id',auth.uid(),'merchants',coalesce((
    select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'city_name',c.name,
      'role',case when m.owner_id=auth.uid() then 'owner' else 'operator' end) order by m.name,m.id)
    from private.merchants m join public.cities c on c.id=m.city_id
    where private.business_chat_can_use(auth.uid(),m.id)
  ),'[]'::jsonb),'invitations','[]'::jsonb);
end;
$$;
alter function public.get_my_business_chat_profiles() owner to postgres;
revoke all on function public.get_my_business_chat_profiles() from public,anon,authenticated,service_role;
grant execute on function public.get_my_business_chat_profiles() to authenticated;
notify pgrst,'reload schema';
