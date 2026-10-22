begin;

select plan(7);

select results_eq(
  $$select slug from public.tags order by sort_order$$,
  array['life', 'festival', 'food', 'travel', 'shopping', 'settlement', 'transport', 'housing', 'education', 'business', 'meetup', 'jobs', 'used'],
  'jobs and used are the final categories'
);

select results_eq(
  $$select label from public.tags order by sort_order$$,
  array['라이프', '페스티벌', '맛집', '여행', '쇼핑', '정착', '이동', '주거', '교육', '비즈니스', '모임', '구인구직', '중고거래'],
  'category labels match the app'
);

select results_eq(
  $$select slug from public.tags where kind = 'meetup' order by sort_order$$,
  array['meetup'],
  'only meetup creates a room preview'
);

select results_eq(
  $$select count(*)::integer from public.tags where slug in ('daily', 'question', 'info', 'roommate', 'rent_offer', 'rent_seek')$$,
  array[0],
  'legacy tags are removed'
);

select results_eq(
  $$select t.slug from public.posts p join public.tags t on t.id = p.tag_id where p.id = '20000000-0000-0000-0000-000000000003'$$,
  array['transport'],
  'winter tire post moves to transport'
);

select results_eq(
  $$select count(*)::integer from public.posts where id between '20000000-0000-0000-0000-000000000001' and '20000000-0000-0000-0000-000000000035'$$,
  array[35],
  'all seeded posts are preserved'
);

select results_eq(
  $$select count(*)::integer from public.posts p join public.tags t on t.id = p.tag_id where p.room_preview is not null and t.slug <> 'meetup'$$,
  array[0],
  'only meetup posts keep room previews'
);

select * from finish();
rollback;
