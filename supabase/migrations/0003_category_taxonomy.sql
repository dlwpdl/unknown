-- 피드와 글쓰기를 9개 생활 대분류로 통일한다.
-- 세부 주제는 posts.hashtags에 남기고 모임만 room_preview를 유지한다.

update public.tags
set slug = 'life', label = '라이프', sort_order = 1, kind = 'post'
where id = 1 and slug = 'daily';

update public.tags
set label = '맛집', sort_order = 2, kind = 'post'
where id = 4 and slug = 'food';

update public.tags
set label = '모임', sort_order = 9, kind = 'meetup'
where id = 5 and slug = 'meetup';

insert into public.tags (id, slug, label, sort_order, kind) values
  (10, 'travel', '여행', 3, 'post'),
  (11, 'shopping', '쇼핑', 4, 'post'),
  (12, 'settlement', '정착', 5, 'post'),
  (13, 'transport', '이동', 6, 'post'),
  (14, 'housing', '주거', 7, 'post'),
  (15, 'education', '교육', 8, 'post');

-- 기존 질문·정보 글 중 주제가 명확한 시드 글을 먼저 분류한다.
update public.posts
set tag_id = 13
where id in (
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000013'
);

update public.posts
set tag_id = 12
where id = '20000000-0000-0000-0000-000000000009';

-- 나머지 legacy 분류는 정보 손실 없이 가장 가까운 대분류로 이동한다.
update public.posts set tag_id = 14 where tag_id in (6, 8, 9);
update public.posts set tag_id = 11 where tag_id = 7;
update public.posts set tag_id = 1 where tag_id in (2, 3);

update public.posts p
set room_preview = null
from public.tags t
where p.tag_id = t.id
  and t.kind = 'post'
  and p.room_preview is not null;

delete from public.tags
where id in (2, 3, 6, 7, 8, 9);

select setval(
  pg_get_serial_sequence('public.tags', 'id'),
  (select max(id) from public.tags),
  true
);
