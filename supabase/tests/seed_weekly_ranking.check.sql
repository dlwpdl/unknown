-- Run against the 2026-09-21 content batch; read-only check of the public feed RPC.
do $$
declare city text; ranking jsonb;
begin
  foreach city in array array['vancouver','toronto','montreal','edmonton'] loop
    ranking := public.get_weekly_ranking(city);
    assert jsonb_array_length(coalesce(ranking->'entries','[]'::jsonb))=10,
      format('%s must expose 10 weekly entries',city);
    assert not exists (
      select 1 from jsonb_array_elements(ranking->'entries') e
      join public.posts p on p.id=(e->>'postId')::uuid
      where p.city_id<>city or (e->>'views')::integer<=0), 'city isolation and positive views';
    assert (ranking->'entries'->0->>'views')::integer >= 200, 'seed view counts affect ranking';
  end loop;
end $$;
