-- Home "가볼 만한 곳" counts real members only: persona and seed saves or ratings never push a place onto
-- members' home (persona red lines, 20261030200000: no reviews or recommendations by operated characters).
create or replace function public.get_city_place_signals(p_city_id text) returns text[]
language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(ranked.place_id order by ranked.people desc, ranked.last_at desc, ranked.place_id), '{}'::text[])
  from (
    select s.place_id, count(distinct s.user_id) as people, max(s.seen_at) as last_at
    from (
      select p.place_review_osm_id as place_id, p.author_id as user_id, p.created_at as seen_at
        from public.posts p
       where p.city_id=p_city_id and p.place_review_osm_id is not null and p.place_review_score is not null
         and p.status='published' and exists(select 1 from public.get_public_post(p.id))
      union all
      select sp.place_key, sp.user_id, sp.created_at
        from private.saved_places sp
       where sp.city_id=p_city_id and sp.place_key like 'osm:%'
    ) s
    where private.is_active_account(s.user_id) and not private.is_operated_character(s.user_id)
    group by s.place_id
    having count(distinct s.user_id)>=2
    order by people desc, last_at desc, s.place_id
    limit 20
  ) ranked
$$;
notify pgrst, 'reload schema';
