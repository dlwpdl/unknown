-- 이 글 숨기기 (owner 2026-11-04 보드 "숨기기 새로 만들기"): 남의 글 ··· 에서 숨긴 글은 그 사람의 글 목록에서만 빠진다.
-- 신고 기록은 만들지 않는다. 링크로 여는 글 상세(get_public_post)는 그대로 열린다.
create table private.hidden_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index hidden_posts_post_id_idx on private.hidden_posts(post_id);
alter table private.hidden_posts enable row level security;
alter table private.hidden_posts owner to postgres;
revoke all on private.hidden_posts from public,anon,authenticated,service_role;

-- "내 글"은 오늘 카드와 같은 뜻: 내가 쓴 개인 글. 비즈니스 글은 카드가 늘 남의 글로 보여 주므로 숨길 수 있다.
create function public.set_post_hidden(p_post_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); target public.posts;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_hidden is null then raise exception 'INVALID_POST_HIDDEN'; end if;
  perform private.assert_active_account(uid);
  select * into target from public.posts where id = p_post_id;
  if target.id is null then raise exception 'POST_NOT_FOUND'; end if;
  if target.author_id = uid and target.business_author_id is null then raise exception 'OWN_POST_NOT_HIDDEN'; end if;
  if not p_hidden then
    delete from private.hidden_posts where user_id = uid and post_id = p_post_id;
    return;
  end if;
  -- One lock per member, so two quick taps cannot both slip past the cap.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':hidden-posts', 0));
  if exists(select 1 from private.hidden_posts where user_id = uid and post_id = p_post_id) then return; end if;
  if (select count(*) from private.hidden_posts where user_id = uid) >= 5000 then raise exception 'HIDDEN_POST_LIMIT'; end if;
  insert into private.hidden_posts(user_id, post_id) values (uid, p_post_id);
end $$;
alter function public.set_post_hidden(uuid,boolean) owner to postgres;
revoke all on function public.set_post_hidden(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_post_hidden(uuid,boolean) to authenticated;

-- The app's post lists: 오늘 최신순(모임 탭·장소 후기도 같은 함수)·인기순, 지도, 통합 검색, 주간 순위, 작성자·비즈니스 글 목록.
-- Each condition must appear exactly once; anything else means the function changed and the migration stops.
do $hidden$
declare
  item record;
  definition text;
begin
  for item in select * from (values
    ('private.business_base_get_public_feed_page_v2(text,smallint,text,timestamptz,uuid,integer)',
     'not private.has_reported(auth.uid(), ''post'', post.id)', 'auth.uid()', 'post.id'),
    ('private.business_base_get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer)',
     'not private.has_reported(auth.uid(),''post'',post.id)', 'auth.uid()', 'post.id'),
    ('private.business_base_get_discovery_posts(text,smallint,text,timestamptz,uuid,integer)',
     'not private.has_reported(viewer,''post'',post.id)', 'viewer', 'post.id'),
    ('public.search_public_directory(text,text,text,integer,jsonb)',
     'not private.has_reported(auth.uid(),''post'',p.id)', 'auth.uid()', 'p.id'),
    ('public.get_weekly_ranking(text)',
     'not private.has_reported(auth.uid(), ''post'', p.id)', 'auth.uid()', 'p.id'),
    ('private.business_base_get_public_author_posts(uuid,timestamptz,uuid,integer)',
     'not private.is_blocked_between(auth.uid(), post.author_id)', 'auth.uid()', 'post.id'),
    ('public.get_merchant_profile_posts(uuid,text,integer)',
     'where p.business_author_id=p_merchant_id and private.public_post_business_id(p.id)=p_merchant_id', 'auth.uid()', 'p.id')
  ) as hide(signature, anchor, viewer, post) loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if array_length(string_to_array(definition, item.anchor), 1) <> 2 then raise exception 'HIDDEN_POSTS_ANCHOR_CHANGED: %', item.signature; end if;
    execute replace(definition, item.anchor, item.anchor || format(
      ' and not exists(select 1 from private.hidden_posts hidden_post where hidden_post.user_id=%s and hidden_post.post_id=%s)', item.viewer, item.post));
  end loop;
end $hidden$;

-- 오늘 카드 ··· 의 이 글 숨기기. An unknown target rejects the whole analytics batch, so this must reach production before an app build that uses it.
insert into private.behavior_targets(id) values
  ('post.manage.hide')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
