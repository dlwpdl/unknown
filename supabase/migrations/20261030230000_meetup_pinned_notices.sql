-- Owner 2026-10-30: one pinned notice per room (like KakaoTalk) is too few. The room's top now lists the host's
-- member-wide notices sent in the last 14 days, newest first, up to 5 ('pinnedNotices'). 'pinned' stays the newest
-- one for app versions that read a single notice. Sending, limits, audiences, safety review and unpin (host only,
-- via update_meetup_announcement) are unchanged; co-hosts read like members.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_meetup_loyalty(uuid)'::regprocedure);
  old_declare text := 'pinned jsonb; result jsonb;';
  old_select text := $old$    select jsonb_build_object('id',a.id,'body',a.body,'sentAt',a.sent_at) into pinned from private.meetup_announcements a
    where a.post_id=event.id and a.audience='members' and a.pinned and a.sent_at>now()-interval '14 days' and a.cancelled_at is null
    order by a.sent_at desc limit 1;$old$;
  old_result text := '''pinned'',pinned);';
begin
  if array_length(string_to_array(definition, old_declare), 1) <> 2
    or array_length(string_to_array(definition, old_select), 1) <> 2
    or array_length(string_to_array(definition, old_result), 1) <> 2 then
    raise exception 'MEETUP_LOYALTY_PINNED_CHANGED';
  end if;
  definition := replace(definition, old_declare, 'pinned jsonb; notices jsonb; result jsonb;');
  definition := replace(definition, old_select, $new$    select coalesce(jsonb_agg(x.item order by x.sent_at desc,x.id desc),'[]'::jsonb) into notices from(
      select jsonb_build_object('id',a.id,'body',a.body,'sentAt',a.sent_at) item,a.sent_at,a.id from private.meetup_announcements a
      where a.post_id=event.id and a.audience='members' and a.pinned and a.sent_at>now()-interval '14 days' and a.cancelled_at is null
      order by a.sent_at desc,a.id desc limit 5)x;
    pinned:=notices->0;$new$);
  definition := replace(definition, old_result, '''pinned'',pinned,''pinnedNotices'',coalesce(notices,''[]''::jsonb));');
  execute definition;
end $migration$;

revoke all on function public.get_meetup_loyalty(uuid) from public,anon,service_role;
grant execute on function public.get_meetup_loyalty(uuid) to authenticated;
insert into private.behavior_targets(id) values('meetup.notice.expand') on conflict do nothing;
notify pgrst, 'reload schema';
