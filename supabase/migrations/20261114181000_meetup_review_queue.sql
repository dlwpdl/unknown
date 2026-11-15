-- 모임 후기 · 매너 평가 screen (A-review-01, owner 2026-11-14 "추천항목으로 진행해"): one row per session the member attended,
-- with its date, the last day a review can be left and whether one was left, so the review due first can sit at the top.
-- Same members, window and limit as get_my_meetup_review_inbox, which stays for apps that read the meetup-level list.
-- canReview and reviewStatus repeat the get_meetup_sessions fields (20261011083000) so the list and the session screen agree.
-- Returns only the caller's own attendance and their own review status; post title/zone are already visible to them.
create function public.get_my_meetup_review_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select coalesce(jsonb_agg(item order by starts_at desc),'[]'::jsonb) into result from(
    select s.starts_at,jsonb_build_object('sessionId',s.id,'postId',p.id,'title',p.title,
      'kind',coalesce(p.room_preview->>'eventKind','group'),'timezone',nullif(p.room_preview->>'timezone',''),'cityId',p.city_id,
      'startsAt',s.starts_at,'endsAt',s.ends_at,'reviewUntil',s.ends_at+interval '7 days',
      'isHost',p.author_id=u,'verified',a.confirmed_at is not null,
      'canReview',a.confirmed_at is not null and s.host_id<>u and s.ends_at<=now() and s.ends_at>now()-interval '7 days'
        and coalesce(p.room_preview->>'eventKind','group')='group',
      'reviewStatus',(select r.status from private.trust_reviews r where r.kind='meetup' and r.session_id=s.id and r.author_id=u)) item
    from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id join public.posts p on p.id=s.post_id
    where a.user_id=u and s.ends_at>now()-interval '30 days' order by s.starts_at desc limit 30) page;
  return result;
end;
$$;
revoke all on function public.get_my_meetup_review_queue() from public,anon,authenticated,service_role;
grant execute on function public.get_my_meetup_review_queue() to authenticated;
alter function public.get_my_meetup_review_queue() owner to postgres;
notify pgrst,'reload schema';
