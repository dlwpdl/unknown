-- Owner requested removing visible seed labels. Keep seed identities and permissions intact.
update public.profiles profile
set nickname = regexp_replace(profile.nickname::text, '·예시$', '')::citext
from auth.users account
where account.id = profile.id and account.email like '%@seed.gling.invalid'
  and profile.nickname::text like '%·예시';

update public.posts post
set title = regexp_replace(post.title, '^\[예시\] ', ''),
    body = replace(post.body, E'\n\n※ 글링이 출시 전 화면과 대화 흐름을 확인하기 위해 작성한 목업 게시글입니다.', '')
from auth.users account
where account.id = post.author_id and account.email like '%@seed.gling.invalid'
  and (post.title like '[예시] %' or post.body like '%목업 게시글%');

with edits (post_no, previous, replacement) as (values
  (39, '나눠보는 예시입니다.', '나눠보려고 해요.'),
  (41, '모아보는 예시예요.', '모아보려고 해요.'),
  (44, '출시 뒤 만들어보고 싶은 모임 아이디어를 묻는 예시입니다.', '부담 없이 만날 수 있는 모임을 만들어보고 싶어요.'),
  (47, '계획을 만들어보는 예시입니다.', '계획을 세워보고 있어요.'),
  (48, '구매나 판매를 진행하는 글은 아니고 생활 습관을 나누는 예시입니다.', '옷장을 정리할 때 어떤 기준을 두는지 궁금해요.'),
  (50, '루틴을 모아보는 예시입니다.', '루틴을 나눠보려고 해요.'),
  (51, '실제 방이나 룸메이트를 구하는 글이 아니라 대화 주제를 모으는 예시예요.', '같이 살기 전에 꼭 맞춰보고 싶은 생활 습관이 있나요?'),
  (52, '강좌 모집이나 할인 안내 없이 배우고 싶은 주제를 나누는 예시입니다.', '요즘 배우고 싶은 취미가 있나요?'),
  (53, '이 글은 모임 형식을 고민하는 예시이며 실제 행사나 참가자를 모집하지 않습니다.', '처음 만나는 자리에서 편했던 대화 주제가 있다면 알려주세요.')
)
update public.posts post
set body = replace(post.body, edits.previous, edits.replacement)
from edits, auth.users account
where post.id = ('20000000-0000-0000-0000-' || lpad(edits.post_no::text, 12, '0'))::uuid
  and account.id = post.author_id and account.email like '%@seed.gling.invalid';
