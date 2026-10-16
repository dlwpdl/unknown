-- Only explicit public map attachments are indexed; device/safety locations are never read.
create index posts_discovery_map_idx on public.posts(city_id,sort_at desc,id desc)
  where status='published' and body like '%Google 지도: https://%';

create function public.get_discovery_posts(
 p_city_id text,p_tag_id smallint default null,p_query text default null,
 p_before_sort timestamptz default null,p_before_id uuid default null,p_limit integer default 50
) returns table (
 id uuid,city_id text,title text,body text,hashtags text[],image_paths text[],room_preview jsonb,
 created_at timestamptz,like_count integer,view_count integer,comment_count integer,save_count integer,share_count integer,
 liked_by_me boolean,saved_by_me boolean,author_id uuid,author_nickname text,author_neighborhood text,
 author_verification_level smallint,tag_id smallint,tag_slug text,tag_label text,tag_kind text,
 kind text,listing_status text,price numeric,expires_at timestamptz,bumped_at timestamptz,sort_at timestamptz
) language plpgsql stable security definer set search_path='' set plan_cache_mode=force_custom_plan as $$
#variable_conflict use_column
declare
 viewer uuid:=auth.uid();
 q text:=nullif(left(trim(coalesce(p_query,'')),100),'');
 page_size integer:=greatest(1,least(coalesce(p_limit,50),50));
begin
 if viewer is null or not private.is_active_account(viewer) then return; end if;
 if num_nonnulls(p_before_sort,p_before_id) not in (0,2) then raise exception 'INVALID_MAP_CURSOR'; end if;
 return query select
  post.id,post.city_id,post.title,post.body,post.hashtags,post.image_paths[1:1],post.room_preview,
  post.created_at,post.like_count,post.view_count,post.comment_count,post.save_count,post.share_count,
  false,false,profile.id,profile.nickname::text,profile.neighborhood,profile.verification_level,
  tag.id,tag.slug,tag.label,tag.kind,post.kind,post.listing_status,post.price,post.expires_at,post.bumped_at,post.sort_at
 from public.posts post
 join public.profiles profile on profile.id=post.author_id and profile.account_status='active'
 join public.tags tag on tag.id=post.tag_id
 where post.city_id=p_city_id and post.status='published' and post.body like '%Google 지도: https://%'
  and private.listing_alive(post.kind,post.status,post.listing_status,post.expires_at)
  and not private.is_blocked_between(viewer,post.author_id) and not private.has_reported(viewer,'post',post.id)
  and (p_tag_id is null or post.tag_id=p_tag_id)
  and (q is null or (post.title||' '||post.body||' '||array_to_string(post.hashtags,' ')) ilike '%'||q||'%')
  and (p_before_sort is null or (post.sort_at,post.id)<(p_before_sort,p_before_id))
 order by post.sort_at desc,post.id desc limit page_size;
end;
$$;
revoke all on function public.get_discovery_posts(text,smallint,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_discovery_posts(text,smallint,text,timestamptz,uuid,integer) to anon,authenticated;
insert into private.behavior_targets(id) values
 ('discovery.open'),('discovery.back'),('discovery.filter'),('discovery.mode'),('discovery.search'),
 ('discovery.date'),('discovery.current'),('discovery.refresh'),('discovery.more'),('discovery.card'),
 ('discovery.detail'),('discovery.google'),('discovery.waze'),('discovery.list'),('discovery.map.retry'),('discovery.login')
 on conflict do nothing;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.record_behavior_events(text,text,jsonb)'::regprocedure);
 if strpos(definition,'''events'',''event-detail''')=0 then raise exception 'BEHAVIOR_SCREEN_BASELINE_CHANGED'; end if;
 execute replace(definition,'''events'',''event-detail''','''events'',''event-detail'',''discovery''');
 definition:=pg_get_functiondef('public.record_app_visit(text,text,text)'::regprocedure);
 if strpos(definition,'''events'',''event-detail''')=0 then raise exception 'VISIT_SCREEN_BASELINE_CHANGED'; end if;
 execute replace(definition,'''events'',''event-detail''','''events'',''event-detail'',''discovery''');
end;
$$;
notify pgrst,'reload schema';
