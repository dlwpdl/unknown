-- 남의 거래 이력. "이 사람 거래 많이 했네"를 판단할 재료를 공개한다.
--
-- 점수 하나로 줄이지 않는다. 글링 사용자 상당수가 갓 도착한 사람이라, 단일 점수는
-- 이력이 없다는 이유만으로 신참을 아래에 깔아버린다. 앱이 도우려는 바로 그 사람들이다.
-- 대신 사실만 보여준다. 신참은 낮은 점수가 아니라 "새 이웃"으로 표시된다.
--
-- 거래 횟수는 대화 수가 아니라 **상대한 사람 수**로 센다. 계정 두 개로 주고받아
-- 숫자를 불리는 것을 막는 가장 싼 방법이다.

create or replace function public.get_trade_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  profile public.profiles;
  result jsonb;
begin
  select * into profile from public.profiles where id = p_user_id and account_status = 'active';
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if viewer is not null and private.is_blocked_between(viewer, p_user_id) then raise exception 'BLOCKED'; end if;

  select jsonb_build_object(
    'id', profile.id,
    'nickname', profile.nickname,
    'cityId', profile.city_id,
    'neighborhood', profile.neighborhood,
    'verificationLevel', profile.verification_level,
    'memberSince', profile.created_at,
    -- 개월 수는 서버가 센다. 렌더 중 시계를 읽으면 같은 화면이 매번 달라진다.
    'memberMonths', greatest(0, (extract(epoch from (now() - profile.created_at)) / 2592000)::integer),
    -- 양쪽이 말을 주고받은 구해요·팔아요 대화의 상대 수
    'dealPartners', (
      select count(distinct case when c.user_low_id = p_user_id then c.user_high_id else c.user_low_id end)
      from public.conversations c
      where c.kind = 'direct' and c.origin_post_id is not null and c.accepted_at is not null
        and p_user_id in (c.user_low_id, c.user_high_id)
        and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.user_low_id)
        and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.user_high_id)),
    'closedListings', (
      select count(*) from public.posts p
      where p.author_id = p_user_id and p.kind = 'listing' and p.listing_status = 'closed'),
    'openListings', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'price', x.price, 'createdAt', x.created_at)
        order by x.sort_at desc)
      from (
        select p.id, p.title, p.price, p.created_at, p.sort_at from public.posts p
        where p.author_id = p_user_id and p.kind = 'listing' and p.status = 'published'
          and p.listing_status = 'open'
        order by p.sort_at desc limit 10
      ) x), '[]'::jsonb),
    'reviews', public.get_listing_reputation(p_user_id, 5)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_trade_profile(uuid) from public, anon, authenticated;
grant execute on function public.get_trade_profile(uuid) to anon, authenticated;
