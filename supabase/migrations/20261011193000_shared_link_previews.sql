-- Invitations reveal a cover and public schedule; joining still uses the existing approval flow.
create function public.get_shared_link_preview(p_post_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,'title',p.title,
    'kind',case when p.room_preview is not null then 'meetup' when t.slug='festival' then 'festival' else 'post' end,
    'city',c.name,'label',t.label,
    'schedule',case when p.room_preview is not null then jsonb_build_object(
      'eventKind',p.room_preview->'eventKind','startsAt',p.room_preview->'startsAt','endsAt',p.room_preview->'endsAt',
      'timezone',p.room_preview->'timezone','cadence',p.room_preview->'cadence') end,
    'imagePath',case when public.is_public_post_image(p.image_paths[1]) then p.image_paths[1] end,
    'closed',p.room_preview is not null and not private.meetup_is_open(p.status,p.room_preview))
  from public.posts p join public.profiles a on a.id=p.author_id
  join public.tags t on t.id=p.tag_id join public.cities c on c.id=p.city_id
  where p.id=p_post_id and p.status='published' and a.account_status='active'
    and not private.is_blocked_between(auth.uid(),p.author_id)
    and not private.has_reported(auth.uid(),'post',p.id)
    and not private.has_reported(auth.uid(),'user',p.author_id);
$$;
revoke all on function public.get_shared_link_preview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_shared_link_preview(uuid) to anon,authenticated;
alter function public.get_shared_link_preview(uuid) owner to postgres;
notify pgrst,'reload schema';
