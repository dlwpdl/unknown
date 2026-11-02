-- Owner 2026-10-31: a host can mark a notice must-read. Must-read notices stay on top until the host takes them down;
-- ordinary notices still leave after 14 days. The board still holds 5, and at most 3 can be must-read so the newest
-- ordinary notice always has room. 'pinned' stays the first entry for app versions that read a single notice.
alter table private.meetup_announcements add column must_read boolean not null default false;

do $migration$
declare
  definition text := pg_get_functiondef('public.get_meetup_loyalty(uuid)'::regprocedure);
  old_select text := $old$    select coalesce(jsonb_agg(x.item order by x.sent_at desc,x.id desc),'[]'::jsonb) into notices from(
      select jsonb_build_object('id',a.id,'body',a.body,'sentAt',a.sent_at) item,a.sent_at,a.id from private.meetup_announcements a
      where a.post_id=event.id and a.audience='members' and a.pinned and a.sent_at>now()-interval '14 days' and a.cancelled_at is null
      order by a.sent_at desc,a.id desc limit 5)x;$old$;
  old_result text := '''pinnedNotices'',coalesce(notices,''[]''::jsonb));';
begin
  if array_length(string_to_array(definition, old_select), 1) <> 2
    or array_length(string_to_array(definition, old_result), 1) <> 2 then
    raise exception 'MEETUP_LOYALTY_NOTICES_CHANGED';
  end if;
  definition := replace(definition, old_select, $new$    select coalesce(jsonb_agg(x.item order by x.must_read desc,x.sent_at desc,x.id desc),'[]'::jsonb) into notices from(
      select jsonb_build_object('id',a.id,'body',a.body,'sentAt',a.sent_at,'mustRead',a.must_read) item,a.must_read,a.sent_at,a.id from private.meetup_announcements a
      where a.post_id=event.id and a.audience='members' and a.pinned and a.cancelled_at is null and a.sent_at is not null
        and (a.must_read or a.sent_at>now()-interval '14 days')
      order by a.must_read desc,a.sent_at desc,a.id desc limit 5)x;$new$);
  definition := replace(definition, old_result, '''pinnedNotices'',coalesce(notices,''[]''::jsonb),''noticeBoard'',true);');
  execute definition;
end $migration$;

create or replace function public.update_meetup_announcement(p_announcement_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_action='cancel' then
    update private.meetup_announcements set cancelled_at=clock_timestamp() where id=p_announcement_id and host_id=u and sent_at is null and cancelled_at is null;
  elsif p_action='unpin' then
    update private.meetup_announcements set pinned=false,must_read=false where id=p_announcement_id and host_id=u and sent_at is not null;
  elsif p_action='must_read' then
    select post_id into event_id from private.meetup_announcements
      where id=p_announcement_id and host_id=u and sent_at is not null and audience='members' and pinned and cancelled_at is null;
    if event_id is null then raise exception 'ANNOUNCEMENT_NOT_FOUND'; end if;
    perform pg_advisory_xact_lock(hashtextextended('meetup_must_read:'||event_id::text,0));
    if (select count(*) from private.meetup_announcements where post_id=event_id and must_read and pinned and id<>p_announcement_id)>=3 then
      raise exception 'MUST_READ_LIMIT';
    end if;
    update private.meetup_announcements set must_read=true where id=p_announcement_id;
  elsif p_action='must_read_off' then
    update private.meetup_announcements set must_read=false where id=p_announcement_id and host_id=u and sent_at is not null;
  else raise exception 'INVALID_ACTION'; end if;
  if not found then raise exception 'ANNOUNCEMENT_NOT_FOUND'; end if;
end $$;

revoke all on function public.update_meetup_announcement(uuid,text) from public,anon,service_role;
grant execute on function public.update_meetup_announcement(uuid,text) to authenticated;
revoke all on function public.get_meetup_loyalty(uuid) from public,anon,service_role;
grant execute on function public.get_meetup_loyalty(uuid) to authenticated;
insert into private.behavior_targets(id) values
  ('meetup.attendance.check-in'),
  ('meetup.attendance.claim'),
  ('meetup.attendance.claim-send'),
  ('meetup.attendance.how'),
  ('meetup.attendance.open'),
  ('meetup.attendance.session'),
  ('meetup.cohost.invite-open'),
  ('meetup.fee.edit'),
  ('meetup.manage.host-tools'),
  ('meetup.home.dues'),
  ('meetup.home.edit'),
  ('meetup.home.members'),
  ('meetup.home.notices'),
  ('meetup.home.primary'),
  ('meetup.home.schedule'),
  ('meetup.home.settings'),
  ('meetup.home.todo'),
  ('meetup.notice.compose-must-read.off'),
  ('meetup.notice.compose-must-read.on'),
  ('meetup.notice.more'),
  ('meetup.notice.must-read'),
  ('meetup.notice.open'),
  ('meetup.notice.read'),
  ('meetup.notice.write'),
  ('meetup.review.submit'),
  ('meetup.roster.open'),
  ('meetup.schedule.add'),
  ('meetup.schedule.session'),
  ('meetup.session.add'),
  ('meetup.session.date'),
  ('meetup.session.length'),
  ('meetup.session.repeat'),
  ('sheet.close'),
  ('sheet.dismiss'),
  ('sheet.grip')
on conflict do nothing;
notify pgrst, 'reload schema';
