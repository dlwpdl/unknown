-- Place ratings remain ordinary moderated posts; legacy text-only reviews stay valid.
create function private.place_review_reference_matches(p_body text,p_place_id text) returns boolean
language sql immutable set search_path='' as $$
  select count(*)=1 and coalesce(bool_and(line='장소 후기: https://www.openstreetmap.org/'
    ||replace(substr(p_place_id,5),':','/')),false)
  from unnest(string_to_array(replace(p_body,E'\r',''),E'\n')) line
  where line ~ '^장소[[:space:]]*후기[[:space:]]*:';
$$;
revoke all on function private.place_review_reference_matches(text,text) from public,anon,authenticated,service_role;
grant execute on function private.place_review_reference_matches(text,text) to authenticated;

alter table public.posts add column place_review_osm_id text;
alter table public.posts add column place_review_score numeric(3,1);
alter table public.posts add constraint posts_place_rating_valid check (
  (place_review_osm_id is null and place_review_score is null) or
  (place_review_osm_id is not null and place_review_score is not null
    and place_review_osm_id ~ '^osm:(node|way|relation):[1-9][0-9]*$'
    and place_review_score between 1 and 10 and place_review_score*2=trunc(place_review_score*2)
    and kind='story' and room_preview is null
    and starts_with(body,'글링 평점: '||to_char(place_review_score,'FM990.0')||E'/10\n\n')
    and private.place_review_reference_matches(body,place_review_osm_id))
);
create unique index posts_one_place_rating_per_member_idx
  on public.posts(author_id,city_id,place_review_osm_id) where place_review_osm_id is not null;
create index posts_place_rating_summary_idx on public.posts(city_id,place_review_osm_id)
  include(place_review_score,id) where status='published' and place_review_score is not null;

create function private.guard_place_rating_write() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' and (
    (tg_op='INSERT' and (new.place_review_osm_id is not null or new.place_review_score is not null)) or
    (tg_op='UPDATE' and (new.place_review_osm_id is distinct from old.place_review_osm_id or new.place_review_score is distinct from old.place_review_score))
  ) then raise exception 'PLACE_RATING_RPC_REQUIRED'; end if;
  return new;
end $$;
revoke all on function private.guard_place_rating_write() from public,anon,authenticated,service_role;
create trigger posts_place_rating_write_guard before insert or update of place_review_osm_id,place_review_score on public.posts
  for each row execute function private.guard_place_rating_write();

create function public.get_place_rating_summaries(p_city_id text,p_place_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_place_ids is null or cardinality(p_place_ids)>25
    or not exists(select 1 from public.cities where id=p_city_id)
    or exists(select 1 from unnest(p_place_ids) id where id is null or id !~ '^osm:(node|way|relation):[1-9][0-9]*$')
  then raise exception 'INVALID_PLACE_RATINGS'; end if;
  with requested as (select distinct unnest(p_place_ids) place_id)
  select coalesce(jsonb_agg(jsonb_build_object('cityId',p_city_id,'placeId',r.place_id,
    'average',s.average,'count',s.count) order by r.place_id),'[]'::jsonb) into result
  from requested r cross join lateral (
    select round(avg(p.place_review_score),1) average,count(*) count from public.posts p
    where p.city_id=p_city_id and p.place_review_osm_id=r.place_id and p.status='published'
      and p.place_review_score is not null and exists(select 1 from public.get_public_post(p.id))
  ) s;
  return result;
end $$;

create function public.get_place_rating_state(p_city_id text,p_place_id text,p_post_ids uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); summary jsonb; mine jsonb; scores jsonb;
begin
  if uid is null or not private.is_active_account(uid) then raise exception 'AUTH_REQUIRED'; end if;
  if p_post_ids is null or cardinality(p_post_ids)>30 then raise exception 'INVALID_PLACE_RATINGS'; end if;
  summary:=public.get_place_rating_summaries(p_city_id,array[p_place_id])->0;
  select jsonb_build_object('id',p.id,'score',p.place_review_score,'body',p.body,'status',p.status) into mine
    from public.posts p where p.author_id=uid and p.city_id=p_city_id and p.kind='story' and p.room_preview is null
      and (p.place_review_osm_id=p_place_id or (p.place_review_osm_id is null and private.place_review_reference_matches(p.body,p_place_id)))
    order by (p.place_review_osm_id is not null) desc,p.created_at desc,p.id desc limit 1;
  select coalesce(jsonb_object_agg(p.id::text,p.place_review_score),'{}'::jsonb) into scores
    from public.posts p where p.id=any(p_post_ids) and p.city_id=p_city_id and p.place_review_osm_id=p_place_id
      and p.status='published' and p.place_review_score is not null and exists(select 1 from public.get_public_post(p.id));
  return summary||jsonb_build_object('myReview',mine,'scores',scores);
end $$;

create function public.write_place_rating(p_city_id text,p_place_id text,p_score numeric,p_title text,p_body text,p_tag_id smallint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); mine public.posts; saved_id uuid; review_text text;
begin
  if uid is null or not private.is_active_account(uid) then raise exception 'AUTH_REQUIRED'; end if;
  review_text:=trim(split_part(substr(p_body,char_length('글링 평점: '||to_char(p_score,'FM990.0')||E'/10\n\n')+1),
    E'\n\n장소 후기: https://www.openstreetmap.org/'||replace(substr(p_place_id,5),':','/'),1));
  if p_place_id is null or p_place_id !~ '^osm:(node|way|relation):[1-9][0-9]*$'
    or not exists(select 1 from public.cities where id=p_city_id)
    or p_score is null or not(p_score between 1 and 10) or p_score*2<>trunc(p_score*2)
    or not exists(select 1 from public.tags where id=p_tag_id and slug in ('life','food') and kind='post')
    or p_title is null or char_length(trim(p_title)) not between 1 and 60
    or p_body is null or char_length(p_body) not between 1 and 4000
    or review_text is null or char_length(review_text) not between 1 and 1000
    or regexp_replace(review_text,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
    or not starts_with(p_body,'글링 평점: '||to_char(p_score,'FM990.0')||E'/10\n\n')
    or not private.place_review_reference_matches(p_body,p_place_id)
  then raise exception 'INVALID_PLACE_RATING'; end if;
  -- Reuse the existing lock order and post create/update paths, including all safety triggers.
  perform private.lock_relationships();
  perform 1 from public.profiles where id=uid and account_status='active' for update;
  select p.* into mine from public.posts p where p.author_id=uid and p.city_id=p_city_id and p.kind='story' and p.room_preview is null
    and (p.place_review_osm_id=p_place_id or (p.place_review_osm_id is null and private.place_review_reference_matches(p.body,p_place_id)))
    order by (p.place_review_osm_id is not null) desc,p.created_at desc,p.id desc limit 1 for update;
  if mine.id is not null then
    if mine.status<>'published' or mine.business_author_id is not null then raise exception 'PLACE_REVIEW_REMOVED'; end if;
    saved_id:=mine.id;
    update public.posts set title=trim(p_title),body=p_body,place_review_osm_id=p_place_id,place_review_score=p_score
      where id=saved_id and author_id=uid;
  else
    saved_id:=public.create_post(p_city_id,p_tag_id,trim(p_title),p_body,'{}','{}',null,'story',null);
    update public.posts set place_review_osm_id=p_place_id,place_review_score=p_score where id=saved_id and author_id=uid;
  end if;
  return jsonb_build_object('id',saved_id,'score',p_score);
end $$;

revoke all on function public.get_place_rating_summaries(text,text[]),public.get_place_rating_state(text,text,uuid[]),
  public.write_place_rating(text,text,numeric,text,text,smallint) from public,anon,authenticated,service_role;
grant execute on function public.get_place_rating_summaries(text,text[]) to anon,authenticated;
grant execute on function public.get_place_rating_state(text,text,uuid[]),
  public.write_place_rating(text,text,numeric,text,text,smallint) to authenticated;

insert into private.behavior_targets(id) values ('places.reviews.score'),('places.ratings.toggle') on conflict(id) do nothing;
notify pgrst,'reload schema';
