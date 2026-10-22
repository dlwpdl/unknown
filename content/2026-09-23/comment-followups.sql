-- 2026-09-23 사용자 지시: 댓글이 공감으로 끝나지 않고 후속 질문까지 달게 한다.
-- 생성한 댓글(문장 풀에서 나온 것)만 대상으로, 공감 + 그 글 제목의 구체 단어를 집은 질문으로 다시 쓴다.
begin;

with lib as (
  select unnest(array[
    '오 이거 궁금했는데','나도 이거 몰라서 헤맴','이거 진짜 맞음','와 이건 처음 알았음','나는 아직도 헷갈림',
    '이거 어디서 봤어?','정보 고마움','이거 저장함','동네마다 다른 게 제일 어려움','나는 반대로 했음',
    '이거 보고 바로 해봄','나만 몰랐던 거임?','이거 자주 물어보는 거였음','우리 동네는 좀 달랐음','담에 가보려고 저장함',
    '이거 검색해도 안 나옴','이런 글 자주 올려줘','이거 시간 지나면 바뀌지 않음?','처음엔 다 어려움','나도 첫 달에 틀렸음',
    '아 이거 내가 잘못 알고 있었음','이거 어디서 확인해?','해보고 후기 남길게','이거 때문에 한참 헤맸음','나는 그냥 물어봄',
    '이런 건 물어보는 게 제일 빠름','동네 사람들 답이 다 다름','이거 나만 헷갈리는 거 아니었네','이거 보고 나도 해봄','이거 어제 겪은 일이랑 똑같음',
    '이건 좀 다르지 않음?','나도 궁금해서 물어봤음','이런 건 사람한테 묻는 게 빨라','처음엔 나만 그런 줄 알았음','이거 알면 진짜 편함',
    '이거 몰라서 손해 봤음','동네마다 답이 다름','이거 시기마다 바뀌는 듯','나도 이제 알았음','혹시 더 있으면 알려줘',
    '이거 보고 바로 저장함','나도 비슷하게 했음','여긴 좀 특이함','이거 꼭 필요한 정보임','나도 헤매다가 찾음',
    '이런 글 있으면 좋겠음','이거 왜 아무도 안 알려줌','나만 어려운 게 아니었네','이거 잘못 알면 큰일 남','다음에 가면 함',
    '와 맞아 나도 이랬어 ㅋㅋ','개공감','이건 좀 쎄다','읽자마자 아 맞다 싶었음','나 이거 똑같이 겪음',
    '아 그래서 그랬구나','이건 진짜 공감','나도 이거 보고 좀 놀람','헐 나만 그런 줄','이거 완전 내 얘기임',
    '아 이거 맞다','나도 똑같이 헷갈렸음','이건 좀 중요함','와 이거 몰랐음','나도 이런 적 있음'
  ]) as s
), matched as (
  select c.id, c.post_id, p.title,
         (select l.s from lib l where c.body like l.s || '%' order by length(l.s) desc limit 1) as reaction,
         coalesce(tg.slug, 'life') as slug
  from public.comments c
  join public.posts p on p.id = c.post_id
  left join public.tags tg on tg.id = p.tag_id
  where c.parent_id is null and c.deleted_at is null
), target as (
  select matched.*,
         nullif(regexp_replace(
                  split_part(regexp_replace(matched.title, '[^가-힣A-Za-z0-9 ]', ' ', 'g'), ' ', 2),
                  '(은|는|이|가|을|를|에|도|와|과|로|으로|의)$', ''), '') as word
  from matched
)
update public.comments c
set body = target.reaction || ' ' || (
    case when target.word is not null and abs(hashtext(c.id::text || '-k')::bigint) % 2 = 0
      then (array[
             '아 근데 ' || target.word || '는 어땠어?',
             '그럼 ' || target.word || '도 같은 거야?',
             target.word || '는 따로 알아봐야 함?',
             target.word || '는 어디서 봤어?',
             '혹시 ' || target.word || ' 해봄?',
             target.word || '는 어떻게 확인함?'
           ])[1 + (abs(hashtext(c.id::text || target.word || '-kq')::bigint) % 6)::int]
      else (case target.slug
             when 'transport' then (array['환승은 어떻게 함?', '막차는 몇 시쯤임?', '주말엔 배차 다른가?', '주차는 어디에 함?', '요금은 얼마임?', '카드도 되나?'])
             when 'food' then (array['가격대는 어느 정도임?', '웨이팅 있음?', '혼자 가도 됨?', '주차는 되나?', '예약해야 함?', '몇 시가 한산함?'])
             when 'education' then (array['신청은 어디서 함?', '자격 조건 있음?', '예약해야 함?', '비용은 드나?', '아이도 같이 됨?', '몇 살부터 됨?'])
             when 'settlement' then (array['서류는 뭐 필요함?', '처리 기간은 얼마나 걸림?', '온라인도 되나?', '예약 필요한가?', '비용은 드나?', '어디서 신청함?'])
             when 'travel' then (array['주차는 어디에 함?', '몇 시가 한산함?', '입장료 있음?', '가는 길은 편함?', '주말엔 붐빔?', '예약해야 함?'])
             else (array['동네마다 다른가?', '이거 어디서 확인함?', '신청은 어디서 함?', '비용은 드나?', '시기는 언제가 좋음?', '안 하면 어떻게 됨?'])
           end)[1 + (abs(hashtext(c.id::text || target.slug || '-q')::bigint) % 6)::int]
    end)
from target
where c.id = target.id
  and target.reaction is not null
  and abs(hashtext(c.id::text || '-ask3')::bigint) % 10 < 8;

select count(*) filter (where body like '%?%') as with_question, count(*) as total from public.comments where parent_id is null;
commit;
