-- 2026-09-22 오늘 올릴 도시별 5건. 말투는 앱 안 반말 톤(voice.md)이고,
-- 각 글은 오늘 확인한 공식 안내 페이지를 출처로 단다.
-- 작성자는 도시별 기존 프로필 5명을 재사용한다. 새 프로필을 만들지 않고 도시도 섞지 않는다.
-- 등록 시각은 지금으로부터 25~275분 전 사이로 흩어지고, 조회수는 5~120 사이 값이다.
begin;

create temporary table gling_today (
  ord integer, city_id text, tag_slug text, title text, body text, source text, slot integer
) on commit drop;

insert into gling_today values
 (1,'vancouver','transport','컴패스 카드 한 장으로 버스, 스카이트레인, 씨버스 다 됨',
  E'컴패스 카드 하나면 버스, 스카이트레인, 씨버스 다 됨. 카드 종류가 몇 개라서 자기 이동 패턴부터 보는 게 빠름.\n나는 자동충전 걸어두고 잔액 확인을 안 하게 됐는데, 요금과 카드 종류는 바뀔 수 있으니 TransLink 안내에서 확인하고 가라.\n다들 자동충전 걸어둠?',
  'https://www.translink.ca/transit-fares/compass-card',1),
 (2,'vancouver','education','VPL 카드 만들면 전자책까지 같이 열림',
  E'시립도서관 카드는 책만 빌리는 게 아님. VPL 카드 만들면 전자책이랑 온라인 자료도 같이 쓰게 됨.\n신분 확인 서류가 필요한데 뭘 가져가야 하는지는 사이트에 정리돼 있음.\n카드 만들 때 뭐 들고 갔는지 기억나?',
  'https://www.vpl.ca/borrowing/library-card',2),
 (3,'vancouver','life','눈 오는 날 시가 어느 길부터 치우는지 알아두면 편함',
  E'밴쿠버는 눈이 별로 안 오는데 한 번 오면 다들 난리 남. 시에서 어느 길부터 치우는지 순서가 정해져 있어서 자기 동네가 어디쯤인지 알아두면 아침에 덜 헤맴.\n기준은 매년 조정될 수 있으니 시 안내를 보고, 집 앞 보도 정리 의무도 같이 확인해라.\n눈 온 날 출근 어떻게 했어?',
  'https://vancouver.ca/streets-transportation/snow-removal-from-city-streets.aspx',3),
 (4,'vancouver','life','밴쿠버 수거는 일반, 재활용, 음식물이 다 따로임',
  E'밴쿠버 수거는 일반쓰레기, 재활용, 음식물이 다 따로임. 날짜를 헷갈리면 밖에 나가 있는 걸 보고 판단하게 되는데, 주소 넣으면 수거일 알려주는 안내가 있음.\n집마다 날짜가 달라서 이사 오고 첫 달에 한 번은 틀리는 듯.\n첫 수거일에 뭐 버렸는지 기억나?',
  'https://vancouver.ca/home-property-development/waste-disposal-and-recycling.aspx',4),
 (5,'vancouver','life','가로등 꺼져 있으면 Van311에 접수하면 됨',
  E'길에 문제가 있거나 가로등이 꺼져 있으면 Van311에 신고하면 됨. 앱이나 전화로 되고 사진 올리면 위치 설명이 필요 없어서 편함.\n급한 게 아니어도 일단 접수해두면 담당 부서로 가는 것 같음.\n311 써본 적 있음?',
  'https://vancouver.ca/van311.aspx',5),
 (6,'toronto','transport','Bike Share는 반납 전에 빈 도크부터 확인',
  E'토론토는 Bike Share 자전거가 동네마다 있어서 짧게 이동할 때 편함. 다만 도크가 꽉 차 있으면 반납이 안 되니까 반납 전에 앱에서 빈 자리 확인하는 게 안전함.\n요금제가 몇 가지니 자기 패턴 보고 고르면 됨.\n자전거로 출퇴근하는 사람 있음?',
  'https://bikesharetoronto.com/',1),
 (7,'toronto','education','TPL 대출은 연체료보다 대출 정지가 먼저 옴',
  E'토론토 도서관은 책만 빌리는 게 아니라 대출 기간과 연장 규칙이 정해져 있음. 늦으면 연체료 대신 대출이 막히는 방식이라 규칙 한 번 보면 마음 편함.\n예약 걸어두면 인기 책도 순서가 되면 알려줌.\n도서관에서 제일 자주 빌리는 거 뭐임?',
  'https://tpl.ca/using-the-library/borrowing-materials/',2),
 (8,'toronto','life','토론토는 311로 시에 말하고 접수번호를 받음',
  E'토론토는 311로 시에 신고하거나 물어보는 게 됨. 쓰레기 수거가 안 됐다, 길에 구멍이 있다 같은 것도 다 접수되고 번호가 나옴.\n급할 때 어디다 말해야 하나 싶으면 311부터 보면 됨.\n311로 해결된 일 있음?',
  'https://www.toronto.ca/home/311-toronto-at-your-service/',3),
 (9,'toronto','education','시립 프로그램은 등록 시작일이 정해져 있음',
  E'토론토 시립 프로그램은 등록 시작일이 정해져 있어서 그날 몰림. 원하는 시간대가 있으면 시작 전에 계정 만들고 결제 정보까지 넣어두는 게 편함.\n인기 프로그램은 몇 분 만에 차니까 일정부터 확인해라.\n시 프로그램 들어본 적 있음?',
  'https://www.toronto.ca/explore-enjoy/parks-recreation/program-activities/register-for-recreation-activities/',4),
 (10,'toronto','life','큰 물건은 수거 규칙이 따로 있음',
  E'토론토는 재활용, 음식물, 일반쓰레기를 다 따로 버림. 큰 가구나 전자제품은 일반 수거로 안 되고 따로 신청하거나 규칙을 지켜야 함.\n버리는 날도 같이 봐야 하니까 이사하고 제일 헷갈리는 부분임.\n큰 물건 버려본 적 있음?',
  'https://www.toronto.ca/services-payments/recycling-organics-garbage/',5),
 (11,'montreal','transport','몬트리올 교통 요금은 며칠 쓸지로 고름',
  E'몬트리올 대중교통은 요금 종류가 좀 많음. 한 번, 하루, 주말, 월간처럼 나뉘어 있어서 며칠 쓸지 정하고 고르면 됨.\n충전은 OPUS나 앱에서 되는데 종류마다 되는 곳이 달라서 STM 안내에서 확인해야 함.\n너는 어떤 표 쓰고 있음?',
  'https://www.stm.info/en/info/fares',1),
 (12,'montreal','life','제설 표지 걸린 구역에 세워두면 차가 끌려감',
  E'몬트리올은 눈 오면 시에서 제설을 돌리는데, 주차 금지 표지가 걸리면 차를 옮겨야 함. 안 옮기면 견인됨.\n제설이 시작되면 구역별로 순서가 있어서 자기 동네 표지랑 시 안내를 봐두는 게 좋음.\n겨울에 차 옮긴 적 있음?',
  'https://montreal.ca/en/snow-removal',2),
 (13,'montreal','life','몬트리올 재활용은 상자 접어서 내는 게 기본',
  E'몬트리올은 재활용 배출 규칙이 생각보다 자세함. 용기, 포장재, 인쇄물이 다 들어가는데 봉투에 싸서 내면 안 되는 것도 있음.\n큰 종이 상자는 접어서 내라고 안내돼 있음. 이사 오면 제일 헷갈리는 부분임.\n뭐가 제일 헷갈렸어?',
  'https://montreal.ca/en/topics/recycling',3),
 (14,'montreal','life','몬트리올 수돗물은 그냥 마셔도 됨',
  E'몬트리올 수돗물은 마실 수 있음. 수도관이 오래된 동네는 안내가 따로 나올 때도 있어서 물 맛이나 색이 이상하면 시 안내를 확인하는 게 좋음.\n정수기 쓰는 사람도 많고 그냥 마시는 사람도 많음.\n너는 그냥 마심?',
  'https://montreal.ca/en/topics/drinking-water',4),
 (15,'montreal','life','제설 진행 상황은 구역별로 볼 수 있음',
  E'몬트리올은 제설 진행 상황을 구역별로 볼 수 있게 해놨음. 눈 온 다음 날 아침에 길 상태가 궁금하면 확인해보면 됨.\n자기 동네 순서가 언제쯤인지 보이니까 계획 세우기 편함.\n눈 온 날 출근 어떻게 함?',
  'https://services.montreal.ca/en/snowremoval/avancement',5),
 (16,'edmonton','transport','ETS 요금은 한 번, 하루, 월간으로 나뉨',
  E'에드먼튼 버스랑 LRT 요금은 종류가 몇 개라서 자기 패턴 보고 고르면 됨. 한 번, 하루, 월간 이런 식으로 나뉨.\n요금이 오르기도 하니까 시 안내에서 최신 값 확인해라.\n너는 한 번씩 삼? 패스 삼?',
  'https://www.edmonton.ca/ets/fares-passes',1),
 (17,'edmonton','transport','에드먼튼은 Arc 카드로 버스와 LRT를 같이 탐',
  E'에드먼튼은 Arc 카드로 버스랑 LRT를 같이 탈 수 있음. 카드에 돈 넣어두고 태그하면 되는데, 카드 없이 카드 결제로 바로 타는 방법도 있음.\n어떤 방식이 되는지는 시 안내에서 확인하고, 처음이면 Arc부터 보면 됨.\nArc 써봄?',
  'https://www.edmonton.ca/ets/arc',2),
 (18,'edmonton','life','에드먼튼도 311로 접수하고 번호를 받음',
  E'에드먼튼도 311로 시에 신고하고 물어보면 됨. 길, 쓰레기, 나무, 소음 같은 게 다 접수됨.\n앱이나 전화로 되고 접수 번호가 나오니까 나중에 확인하기도 편함.\n311 써서 해결된 일 있음?',
  'https://www.edmonton.ca/programs_services/311-city-services',3),
 (19,'edmonton','life','겨울 주차 금지 구역은 미리 확인해두기',
  E'에드먼튼은 겨울에 주차 금지가 걸리는 때가 있음. 눈 치우는 동안 길에 세워두면 안 되고, 안 옮기면 견인될 수 있음.\n자기 동네가 어느 구역인지랑 언제 걸리는지 미리 봐두면 겨울에 덜 놀람.\n겨울에 차 어떻게 두고 있음?',
  'https://www.edmonton.ca/transportation/on_your_streets/seasonal-parking-ban',4),
 (20,'edmonton','life','겨울엔 나가기 전에 길 상태부터 봄',
  E'에드먼튼 겨울에는 길 상태를 보고 나가야 함. 시에서 제설 상태랑 주의사항을 안내해두니까 출근 전에 한 번 보는 것만으로도 계획이 달라짐.\n버스가 늦는 날도 많으니 시간 여유를 두는 게 편함.\n겨울에 몇 분 일찍 나옴?',
  'https://www.edmonton.ca/transportation/on_your_streets/snow-ice',5);

-- 도시별 오늘 쓸 프로필 5명. 이미 글이 있는 프로필 중 글 수가 적은 순, 동률이면 해시 순.
create temporary table gling_today_author on commit drop as
select pick.city_id, pick.slot, pick.author_id
from (
  select slot.city_id, slot.slot,
         (select pr.id
          from public.profiles pr
          where pr.city_id = slot.city_id
            and pr.account_status = 'active'
            and exists (select 1 from public.posts x where x.author_id = pr.id and x.status = 'published')
          order by (select count(*) from public.posts x where x.author_id = pr.id and x.status = 'published'),
                   abs(hashtext(pr.id::text)::bigint)
          offset slot.slot - 1 limit 1) as author_id
  from (select distinct city_id, slot from gling_today) slot
) pick;

insert into public.posts (author_id, city_id, tag_id, title, body, status, view_count, created_at)
select a.author_id,
       seed.city_id,
       tag.id,
       seed.title,
       seed.body || E'\n\n출처: ' || seed.source,
       'published',
       5 + (abs(hashtext(seed.title || 'v')::bigint) % 116)::int,
       now() - make_interval(mins => 25 + (abs(hashtext(seed.title)::bigint) % 250)::int)
from gling_today seed
join gling_today_author a on a.city_id = seed.city_id and a.slot = seed.slot
join public.tags tag on tag.slug = seed.tag_slug;

-- 주간 랭킹이 읽는 초기 조회 기록을 새 글에도 붙인다.
insert into private.post_view_pulse (post_id, bucket, views)
select p.id, date_bin(interval '10 minutes', p.created_at, '2000-01-01'::timestamptz), p.view_count
from public.posts p
join gling_today seed on seed.title = p.title and seed.city_id = p.city_id
where p.status = 'published';

commit;
