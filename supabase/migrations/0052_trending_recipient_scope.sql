-- 시드·심사용 계정은 알림을 읽지 않는다. 수신자에서 빼야 어드민의 "N명"이 실제 도달을 뜻한다.
create or replace function private.send_trending_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cfg private.trending_config;
  city record;
  pick record;
  delivered integer;
  sent integer := 0;
begin
  select * into cfg from private.trending_config where id = true;
  if not found or not cfg.enabled or private.trending_quiet_now() then return 0; end if;

  for city in
    select distinct post.city_id from public.posts post
    where post.status = 'published' and post.created_at > now() - make_interval(hours => cfg.max_age_hours)
  loop
    if (select count(*) from private.trending_sent s
        where s.city_id = city.city_id and s.sent_at > now() - interval '24 hours') >= cfg.max_per_city_per_day then
      continue;
    end if;

    select * into pick from private.trending_candidates(city.city_id, 1);
    if not found or pick.score < cfg.min_score then continue; end if;

    insert into private.trending_sent(post_id, city_id, score) values (pick.post_id, pick.city_id, pick.score)
    on conflict do nothing;
    if not found then continue; end if;

    with recipients as (
      insert into public.notifications(user_id, kind, actor_id, target_type, target_id, body, route)
      -- 설정 행은 사용자가 알림 화면을 연 뒤에야 생긴다. 행이 없으면 기본값(켜짐)으로 본다.
      select recipient.id, 'trending_post', pick.author_id, 'post', pick.post_id,
        '지금 뜨는 글 · ' || left(pick.title, 80),
        '/post/' || pick.post_id::text
      from public.profiles recipient
      left join public.notification_preferences prefs on prefs.user_id = recipient.id
      where recipient.city_id = pick.city_id and recipient.account_status = 'active'
        and coalesce(prefs.trending, true) and recipient.id <> pick.author_id
        and not exists (
          select 1 from auth.users u where u.id = recipient.id
            and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access' = 'true'::jsonb))
      on conflict do nothing
      returning 1
    )
    select count(*) into delivered from recipients;

    update private.trending_sent set recipients = delivered where post_id = pick.post_id;
    sent := sent + 1;
  end loop;

  delete from private.post_view_pulse where bucket < now() - interval '7 days';
  return sent;
end;
$$;
revoke all on function private.send_trending_notifications() from public, anon, authenticated;
