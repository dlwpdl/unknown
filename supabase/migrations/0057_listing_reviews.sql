-- 구해요·팔아요 거래 후기.
--
-- 아무나 아무에게나 쓸 수 있는 후기는 몇 주 만에 무의미해지고, 신뢰를 세탁해주는 도구가 된다.
-- 그래서 후기는 "실제로 연락이 오간 거래"에만 붙인다. 근거는 이미 DB 에 있다.
-- 글에서 시작한 1:1 대화가 수락되고 메시지가 오갔다는 사실이 그 증거다.
--
-- 별점은 두지 않는다. 평균이 4.8 근처에 몰려 변별력이 사라진다. 대신 "다시 거래하겠다"
-- 한 가지만 묻고 한 줄을 받는다.

-- 1. 대화가 어느 글에서 시작됐는지 남긴다 --------------------------------
alter table public.conversations add column origin_post_id uuid references public.posts(id) on delete set null;
create index conversations_origin_post_idx on public.conversations(origin_post_id) where origin_post_id is not null;

-- 기존 1인자 버전은 지우고 기본값을 가진 2인자 버전으로 바꾼다.
-- 이미 배포된 앱은 other_user_id 만 보내므로 그대로 동작한다.
drop function if exists public.start_conversation(uuid);
create function public.start_conversation(other_user_id uuid, p_post_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare u uuid:=auth.uid(); c public.conversations; low_id uuid; high_id uuid; origin uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if u=other_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(u,other_user_id) then raise exception 'BLOCKED'; end if;
  -- 상대가 실제로 그 글의 작성자일 때만 출처로 인정한다. 아니면 후기 자격이 조작된다.
  select p.id into origin from public.posts p
    where p.id = p_post_id and p.kind = 'listing' and p.author_id = other_user_id;
  perform private.lock_relationships(); low_id:=least(u,other_user_id); high_id:=greatest(u,other_user_id);
  update public.conversations set status='cancelled',ended_at=created_at where kind='direct' and status='pending'
    and user_low_id=low_id and user_high_id=high_id and created_at<=now()-interval '7 days';
  select * into c from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id and status in ('active','pending');
  if c.id is not null then
    if origin is not null and c.origin_post_id is null then
      update public.conversations set origin_post_id=origin where id=c.id;
    end if;
    return c.id;
  end if;
  -- Anti-spam request pacing is separate from active relationship capacity.
  if exists(select 1 from public.conversations where kind='direct' and user_low_id=low_id and user_high_id=high_id
    and status in ('rejected','cancelled') and ended_at>now()-interval '24 hours') then raise exception 'REQUEST_COOLDOWN'; end if;
  if (select count(*) from public.conversations where requester_id=u and status='pending' and created_at>now()-interval '7 days')>=20 then raise exception 'PENDING_REQUEST_LIMIT'; end if;
  perform private.enforce_rate_limit('conversation_request',20,interval '1 hour',interval '30 seconds');
  insert into public.conversations(user_low_id,user_high_id,requester_id,status,origin_post_id) values(low_id,high_id,u,'pending',origin) returning * into c;
  perform private.create_notification(other_user_id,'message',u,'user',u,
    (select nickname::text from public.profiles where id=u)||'님이 1:1 대화를 요청했어요. 수락 후 대화가 시작돼요.','/chat?conversationId='||c.id::text);
  return c.id;
end;
$function$;
revoke all on function public.start_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_conversation(uuid, uuid) to authenticated;

-- 2. 후기 ------------------------------------------------------------------
create table public.listing_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.profiles(id) on delete cascade,
  would_deal_again boolean not null,
  body text check (body is null or char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, author_id),
  check (author_id <> subject_id)
);
create index listing_reviews_subject_idx on public.listing_reviews(subject_id, created_at desc);

alter table public.listing_reviews enable row level security;
-- 평판은 공개다. 차단한 상대의 후기는 보지 않는다.
create policy "anyone reads reviews" on public.listing_reviews for select
  using (private.is_admin()
    or (private.is_active_account(author_id) and not private.is_blocked_between((select auth.uid()), author_id)));
-- 쓰기는 RPC 로만. 자격 검사가 통째로 서버에 있다.
revoke insert, update, delete on public.listing_reviews from anon, authenticated;
grant select on public.listing_reviews to anon, authenticated;

create trigger listing_reviews_updated_at before update on public.listing_reviews
  for each row execute function private.set_updated_at();

-- 후기도 사용자 작성 글이므로 같은 감시어 검사를 받는다. 보복성 후기와 신상 노출이 여기서 나온다.
alter table public.safety_alerts drop constraint safety_alerts_target_type_check;
alter table public.safety_alerts add constraint safety_alerts_target_type_check
  check (target_type in ('post','comment','message','listing_review'));
alter table public.notifications drop constraint notifications_target_type_check;
alter table public.notifications add constraint notifications_target_type_check
  check (target_type in ('post','comment','message','meetup_request','user','listing_review'));
create trigger listing_reviews_watch_terms after insert or update of body on public.listing_reviews
  for each row execute function private.scan_watch_terms();

-- 3. 자격 검사와 작성 ------------------------------------------------------
-- 수락된 1:1 대화 + 구해요·팔아요 출처 + 양쪽이 실제로 말을 주고받았을 때만 쓸 수 있다.
-- 한쪽만 말한 대화는 거래로 보지 않는다.
create function private.listing_review_partner(p_conversation_id uuid, p_user_id uuid)
returns table(post_id uuid, subject_id uuid)
language sql stable security definer set search_path = '' as $$
  select c.origin_post_id,
    case when c.user_low_id = p_user_id then c.user_high_id else c.user_low_id end
  from public.conversations c
  where c.id = p_conversation_id
    and c.kind = 'direct'
    and c.origin_post_id is not null
    and c.accepted_at is not null
    and p_user_id in (c.user_low_id, c.user_high_id)
    and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.user_low_id)
    and exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.user_high_id);
$$;

create function public.write_listing_review(p_conversation_id uuid, p_would_deal_again boolean, p_body text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); partner record; review_id uuid; already boolean;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_would_deal_again is null then raise exception 'INVALID_REVIEW'; end if;
  select * into partner from private.listing_review_partner(p_conversation_id, u);
  if not found then raise exception 'REVIEW_NOT_ALLOWED'; end if;
  if private.is_blocked_between(u, partner.subject_id) then raise exception 'BLOCKED'; end if;
  -- 도배 제한은 새로 쓸 때만. 자기가 쓴 후기를 고치는 것까지 막으면 오타 하나에 갇힌다.
  select exists (select 1 from public.listing_reviews
    where conversation_id = p_conversation_id and author_id = u) into already;
  if not already then
    perform private.enforce_rate_limit('listing_review', 20, interval '1 day', interval '10 seconds');
  end if;

  insert into public.listing_reviews(conversation_id, post_id, author_id, subject_id, would_deal_again, body)
  values (p_conversation_id, partner.post_id, u, partner.subject_id, p_would_deal_again, nullif(btrim(p_body), ''))
  on conflict (conversation_id, author_id) do update
    set would_deal_again = excluded.would_deal_again, body = excluded.body
  returning id into review_id;
  return review_id;
end;
$$;
revoke all on function public.write_listing_review(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.write_listing_review(uuid, boolean, text) to authenticated;

-- 이 대화에서 후기를 쓸 수 있는지, 이미 썼는지. 채팅 화면이 버튼을 띄울 때 쓴다.
create function public.get_listing_review_state(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); partner record; mine public.listing_reviews;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into partner from private.listing_review_partner(p_conversation_id, u);
  if not found then return jsonb_build_object('canWrite', false); end if;
  select * into mine from public.listing_reviews where conversation_id = p_conversation_id and author_id = u;
  return jsonb_build_object(
    'canWrite', true,
    'postId', partner.post_id,
    'subjectId', partner.subject_id,
    'subjectNickname', (select nickname from public.profiles where id = partner.subject_id),
    'postTitle', (select title from public.posts where id = partner.post_id),
    'mine', case when mine.id is null then null else jsonb_build_object(
      'wouldDealAgain', mine.would_deal_again, 'body', mine.body, 'updatedAt', mine.updated_at) end);
end;
$$;
revoke all on function public.get_listing_review_state(uuid) from public, anon, authenticated;
grant execute on function public.get_listing_review_state(uuid) to authenticated;

-- 한 사람의 평판. 미니 프로필과 프로필 화면이 쓴다.
create function public.get_listing_reputation(p_user_id uuid, p_limit integer default 5)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'wouldDealAgain', count(*) filter (where r.would_deal_again),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'wouldDealAgain', x.would_deal_again, 'body', x.body,
        'createdAt', x.created_at, 'postTitle', p.title,
        'authorNickname', (select nickname from public.profiles where id = x.author_id)))
      from (
        select * from public.listing_reviews
        where subject_id = p_user_id and body is not null
        order by created_at desc limit least(greatest(p_limit, 1), 20)
      ) x join public.posts p on p.id = x.post_id), '[]'::jsonb))
  from public.listing_reviews r
  where r.subject_id = p_user_id
    and private.is_active_account(r.author_id)
    and not private.is_blocked_between((select auth.uid()), r.author_id);
$$;
revoke all on function public.get_listing_reputation(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_listing_reputation(uuid, integer) to anon, authenticated;

-- 감시어 스캐너가 새 표를 알아보게 한다. 매핑이 없으면 후기 경보가 'message' 로 기록돼
-- 어드민이 원문을 찾아갈 수 없다.
create or replace function private.scan_watch_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_json jsonb := to_jsonb(new);
  content text := concat_ws(' ', row_json->>'title', new.body);
  compact text := regexp_replace(lower(normalize(coalesce(content,''), NFKC)), '[[:space:][:punct:]]+', '', 'g');
  hits text[]; top_severity text; top_category text; author uuid; conv uuid;
  target text := case tg_table_name
    when 'posts' then 'post' when 'comments' then 'comment'
    when 'listing_reviews' then 'listing_review' else 'message' end;
  raised boolean;
begin
  select array_agg(term order by case severity when 'critical' then 0 when 'high' then 1 else 2 end, term),
         (array_agg(severity order by case severity when 'critical' then 0 when 'high' then 1 else 2 end))[1],
         (array_agg(category order by case severity when 'critical' then 0 when 'high' then 1 else 2 end))[1]
  into hits, top_severity, top_category
  from private.watch_terms w where w.active and position(regexp_replace(lower(w.term), '[[:space:][:punct:]]+', '', 'g') in compact) > 0;
  if hits is null then return new; end if;
  author := coalesce((row_json->>'sender_id')::uuid, (row_json->>'author_id')::uuid);
  conv := (row_json->>'conversation_id')::uuid;

  insert into public.safety_alerts (target_type, target_id, author_id, conversation_id, category, severity, matched_terms, excerpt)
  values (target, new.id, author, conv, top_category, top_severity, hits, left(content, 600))
  on conflict (target_type, target_id) do update
    set category = excluded.category, severity = excluded.severity,
        matched_terms = excluded.matched_terms, excerpt = excluded.excerpt,
        status = case when public.safety_alerts.matched_terms is distinct from excluded.matched_terms
                 then 'open' else public.safety_alerts.status end
  returning (status = 'open') into raised;
  if not raised then return new; end if;

  insert into public.notifications (user_id, kind, target_type, target_id, body, route)
  select profile.id, 'safety_alert', target, new.id,
    case top_severity when 'critical' then '감시어(긴급)가 포함된 콘텐츠가 올라왔어요. 즉시 확인이 필요합니다.' else '감시어가 포함된 콘텐츠가 올라왔어요. 확인해 주세요.' end,
    '/admin?alert=1'
  from public.profiles profile join auth.users u on u.id = profile.id
  where u.raw_app_meta_data->>'role' = 'admin' and profile.account_status = 'active';
  return new;
end;
$$;
