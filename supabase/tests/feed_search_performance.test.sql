begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
('42100000-0000-0000-0000-000000000001','feed-viewer@example.invalid','{}'),
('42100000-0000-0000-0000-000000000002','feed-author@example.invalid','{}'),
('42100000-0000-0000-0000-000000000003','feed-blocked@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,neighborhood) values
('42100000-0000-0000-0000-000000000001','feed-viewer','vancouver',null),
('42100000-0000-0000-0000-000000000002','needle-author','vancouver','needle-neighborhood'),
('42100000-0000-0000-0000-000000000003','blocked-needle','vancouver',null);
insert into public.posts(author_id,city_id,tag_id,title,body,hashtags,created_at)
select case when n%4=0 then '42100000-0000-0000-0000-000000000003' else '42100000-0000-0000-0000-000000000002' end::uuid,
'vancouver',case when n%2=0 then 1 else 4 end,'needle-title-'||n,'needle-body-'||n,
array['needle-hashtag','red','blue',case when n%2=0 then '#burnaby' else '버나비' end],now()-n*interval '1 minute' from generate_series(1,12) n;
insert into public.blocks(blocker_id,blocked_id) values('42100000-0000-0000-0000-000000000001','42100000-0000-0000-0000-000000000003');
-- Reference uses the original OR predicate, ordering and visibility contract.
create function pg_temp.expected_feed(query text,category smallint,page_size integer) returns uuid[]
language sql stable security definer as $$
select coalesce(array_agg(id order by created_at desc,id desc),'{}') from (
  select p.id,p.created_at from public.posts p
  join public.profiles a on a.id=p.author_id and a.account_status='active'
  where p.status='published' and p.city_id='vancouver' and (category is null or p.tag_id=category)
    and (nullif(trim(coalesce(query,'')),'') is null
      or (p.title||' '||p.body) ilike '%'||trim(query)||'%'
      or a.nickname ilike '%'||trim(query)||'%'
      or coalesce(a.neighborhood,'') ilike '%'||trim(query)||'%'
      or exists(select 1 from unnest(p.hashtags) h where h ilike '%'||trim(query)||'%'))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(),p.author_id))
  order by p.created_at desc,p.id desc limit greatest(1,least(coalesce(page_size,30),50))
) rows;
$$;
select set_config('request.jwt.claims','{"sub":"42100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(
  (select coalesce(array_agg(id order by created_at desc,id desc),'{}') from public.get_public_feed_page('vancouver',category,query,null,null,page_size)),
  pg_temp.expected_feed(query,category,page_size),
  'search preserves original results: '||coalesce(query,'(empty)')||' / limit '||page_size
) from (values
(null::text,null::smallint,5),('needle',null::smallint,5),('needle',1::smallint,3),
('needle-title',null::smallint,30),('needle-body',null::smallint,30),('needle-author',null::smallint,30),
('needle-neighborhood',null::smallint,30),('needle-hashtag',null::smallint,30),
('blocked-needle',null::smallint,30),(E'red\nblue',null::smallint,30),('no-match-ever',null::smallint,30),
('%',null::smallint,5),('_',null::smallint,5),(' 버나비 ',null::smallint,5)
) probes(query,category,page_size);
reset role;
-- Compare trending to the pre-optimization definition, including block filtering
-- and canonical aliases that must still count each author only once.
select results_eq(
$$select * from public.get_trending_hashtags('vancouver')$$,
$$select canonical,count(distinct author_id)::integer from (
 select post.author_id,private.canonicalize_hashtag(raw_hashtag) canonical
 from public.posts post cross join lateral unnest(post.hashtags) raw_hashtag
 where post.status='published' and post.city_id='vancouver' and post.created_at>=now()-interval '7 days'
 and not private.is_blocked_between(auth.uid(),post.author_id)
) tags where canonical is not null group by canonical order by count(distinct author_id) desc,max(canonical) limit 10$$,
'optimized trending preserves exact per-viewer author counts and canonical aliases');
select * from finish();
rollback;
