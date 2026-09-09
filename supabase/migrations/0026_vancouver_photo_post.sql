-- One owner-requested seed post with a licensed, real Coal Harbour photograph.
-- Reuse the managed L1 author; leave safety triggers and engagement defaults intact.
insert into public.posts (id, author_id, city_id, tag_id, title, body, hashtags, image_paths)
select
  '20000000-0000-0000-0000-000000000054'::uuid,
  author.id, 'vancouver', tag.id, '이런 날엔 콜하버 한 바퀴',
  E'물에 비친 빌딩이랑 빼곡히 정박한 배들. 콜하버 사진을 보다 보니 괜히 커피 한 잔 들고 걷고 싶어지네요.\n\n주말에 멀리 안 나가도 이런 풍경이면 충분할 것 같아요. 다들 밴쿠버에서 머리 식히고 싶을 때 어디로 걸으러 가세요?\n\n사진: Vlad D · Unsplash (콜하버, 2022년 공개)\nhttps://unsplash.com/photos/19aJ-K6fUmY',
  array['콜하버', '밴쿠버', '동네산책', '풍경사진'],
  array['10000000-0000-0000-0000-000000000021/vancouver-coal-harbour.jpg']
from public.profiles author
join auth.users account on account.id = author.id and account.email like '%@seed.gling.invalid'
cross join public.tags tag
where author.id = '10000000-0000-0000-0000-000000000021'
  and author.account_status = 'active' and author.ai_safety_consent_at is not null
  and tag.slug = 'life'
on conflict (id) do nothing;
