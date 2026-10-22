begin;
create temporary table gling_today (
  ord integer, city_id text, author_nickname text, tag_slug text, title text, body text, source text
) on commit drop;
insert into gling_today (ord, city_id, author_nickname, tag_slug, title, body, source)
select item.ord, item.city_id, item.author_nickname, item.tag_slug, item.title, item.body, item.source
from jsonb_to_recordset(
$GLING$[{"ord":1,"city_id":"vancouver","author_nickname":"퀸엘리자베스공원","tag_slug":"life","title":"밴쿠버 새 음수대엔 물병 채우는 곳도 붙네","body":"예전엔 길가 음수대 하면 고개 숙여 마시는 모양부터 떠올랐는데, 새로 놓는 건 물병 채우는 장치도 붙음\n기존 음수대 중엔 계절 따라 쉬는 것도 있어서, 물병만 들고 나갈지는 좀 더 생각 중","source":"https://vancouver.ca/home-property-development/water-fountains.aspx"},{"ord":2,"city_id":"vancouver","author_nickname":"예일타운런치","tag_slug":"life","title":"보드 타는 자리도 볼과 스트리트형이 다르네","body":"보드 타는 사람들 공간을 처음 알아보니 공원마다 생김새부터 다름\n밴쿠버 스케이트파크엔 움푹 파인 볼이 있는 곳도, 거리의 턱 같은 구조를 옮긴 스트리트형도 있어\n난 일단 두 모양 구분하는 것부터 익혀두려고, 동네 지도가 또 조금 넓어졌네","source":"https://vancouver.ca/parks-recreation-culture/skateboard-parks.aspx"},{"ord":3,"city_id":"vancouver","author_nickname":"버나비호수","tag_slug":"life","title":"오래된 건물 주소로 보는 밴쿠버 유산 목록","body":"건물 구경할 때 이름 몰라서 아는 척도 못 하겠음 ㅋㅋ 메모 두 개 남겨둠\n1) 밴쿠버 유산 목록은 시의회가 유산 가치를 인정한 건물·구조물을 모은 거고\n2) 도로 주소 순으로 정리돼 있어서 익숙한 길 이름부터 읽어보면 덜 낯설 듯","source":"https://vancouver.ca/home-property-development/vancouver-heritage-register-vhr.aspx"},{"ord":4,"city_id":"vancouver","author_nickname":"도서관단골","tag_slug":"education","title":"VPL엔 소리 녹음하고 옛 사진 옮기는 공간도 있네","body":"책장 사이에서 조용히 읽는 모습이 도서관의 전부처럼 느껴지던 때가 있었는데\nVPL 인스피레이션 랩은 소리·영상·사진을 만들고 보존하는 공간이네\n녹음실이랑 디지털 제작·자료 변환용 작업대가 함께 있고\n센트럴도서관뿐 아니라 스트래스코나 분관에도 이런 공간이 있어\n나는 뭘 남겨보고 싶은지부터 천천히 골라볼까 해","source":"https://www.vpl.ca/facilities/inspiration-labs"},{"ord":5,"city_id":"vancouver","author_nickname":"스카이트레인통근","tag_slug":"transport","title":"스카이트레인 엘리베이터, 있는 것과 운행 중인 건 다름","body":"계단 대신 엘리베이터가 필요한 사람한텐 역 입구부터 동선이 달라짐\n스카이트레인은 모든 역에 엘리베이터가 있어\n다만 수리 중일 수도 있어서, 역에 있다는 말만으로 그날 쓸 수 있다고 보면 안 됨\n이용 안내는 바뀔 수 있으니 출발 전에 엘리베이터 운행 알림을 확인해\n난 동선 볼 때 이걸 먼저 넣을 거야","source":"https://www.translink.ca/opengates"},{"ord":6,"city_id":"toronto","author_nickname":"노스욕센터","tag_slug":"education","title":"TPL 전화 동화에 한국어 이야기도 있네","body":"동화도 화면부터 찾으려던 나 머쓱 ㅋㅋ\nTPL 다이얼어스토리는 전화로 이야기를 듣는 서비스인데 한국어도 있어서, 아이랑 듣는 방식이 꼭 영상일 필요는 없을 듯","source":"https://tpl.ca/using-the-library/services/dial-a-story/"},{"ord":7,"city_id":"toronto","author_nickname":"브램턴출근","tag_slug":"transport","title":"PATH는 지하철 이름이 아니라 걷는 길이네","body":"PATH라는 이름 처음 익히는 중인데 지하철 노선 하나 더 있는 줄 알았어\n토론토 다운타운의 쇼핑 공간이랑 대중교통을 이어주는, 주로 지하에 있는 보행 통로망이네\n밖에서만 길 찾던 머릿속에 층 하나 더 생긴 느낌이라 조금 신기함","source":"https://www.toronto.ca/explore-enjoy/visitor-toronto/getting-around-the-city/"},{"ord":8,"city_id":"toronto","author_nickname":"스카보로블러프","tag_slug":"life","title":"하이파크 동물 전시, 10월 13일부터 휴장 예정이네","body":"아이랑 동물 보러 가려는 사람들은 다음 주 계획이 달라질 수도 있겠네\n하이파크 동물 전시는 접근로 공사 때문에 10월 13일부터 2027년 봄까지 닫는다고 나와 있어\n난 당장 일정을 정하진 못했는데, 이쪽 대신 같이 둘러볼 만한 야외 공간은 어디가 있을까?","source":"https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/zoos-farms/high-park-animal-display/"},{"ord":9,"city_id":"toronto","author_nickname":"벽돌골목빛","tag_slug":"life","title":"토론토 공원 운동기구, 산책이랑 묶어볼 만하네","body":"운동 시작하려니 거창한 계획부터 세우는 게 좀 부담스러워서 적어봄\n1) 토론토엔 야외 운동기구가 있는 공원이 따로 있어\n2) 리버데일 파크 이스트랑 얼스코트 파크도 그 목록에 들어가고\n3) 이 기구들을 위한 정기 운동 수업이 잡혀 있는 건 아니래\n난 산책길에 가까운 곳 하나부터 골라두려고","source":"https://www.toronto.ca/explore-enjoy/parks-recreation/program-activities/fitness/outdoor-fitness-equipment/"},{"ord":10,"city_id":"toronto","author_nickname":"토론토도서관","tag_slug":"education","title":"TPL 악기 대여는 어느 분관인지도 봐야겠네","body":"악기를 덜컥 사기 전에 잠깐 익혀볼 수 있다는 게 좀 반가웠어\nTPL엔 기타·우쿨렐레·바이올린 같은 악기 대여 컬렉션이 있네\n현재 파크데일·다운스뷰·요크우즈 분관에서 다루고, 빌린 분관으로 돌려주는 방식이야\n대여 절차는 바뀔 수 있으니 실제 이용 전엔 다시 확인해야겠어\n아직 뭘 고를지 모르겠는데, 처음 배우기엔 어느 악기가 덜 막막했어?","source":"https://tpl.ca/using-the-library/services/borrow-a-musical-instrument/"},{"ord":11,"city_id":"montreal","author_nickname":"장탈롱바구니","tag_slug":"life","title":"앙그리뇽 공원은 숲이랑 호수가 같이 있네","body":"어릴 때 공원 그림 그리면 나무 몇 그루만 넣었는데, 앙그리뇽은 숲·빈터·호수가 한 공간에 있네\n한쪽 풍경만 보는 산책보다 재밌을 것 같아서, 다음엔 같이 걸을 후보로 여기 넣어두려고","source":"https://montreal.ca/en/places/parc-angrignon"},{"ord":12,"city_id":"montreal","author_nickname":"올드포트바람","tag_slug":"life","title":"몬트리올 도서관 악기 목록엔 타악기도 있네","body":"오래 붙들고 보는 책만 떠올리던 도서관에 악기 목록도 있네\n몬트리올 도서관 악기 컬렉션엔 기타·우쿨렐레 같은 현악기뿐 아니라 건반이랑 타악기도 들어가 있어\n난 우선 악기 이름부터 익혀두려고, 배우고 싶은 소리 고르는 것부터 시작해도 될 듯","source":"https://montreal.ca/en/services/musical-instrument-loans"},{"ord":13,"city_id":"montreal","author_nickname":"올드포트바람","tag_slug":"life","title":"프레데리크백 공원의 흰 구체, 가스 모으는 시설 덮개래","body":"하얀 구체가 놓인 프레데리크백 공원은 예전에 채석장과 쓰레기 매립장이던 곳이래\n그 구체가 땅속에서 생기는 바이오가스를 모으는 우물 덮개라니, 그냥 장식은 아니었네\n어릴 땐 공원 시설은 놀이용부터 떠올렸는데, 다음엔 이런 역할도 같이 보려고","source":"https://montreal.ca/en/articles/parc-frederic-back-unique-metamorphosis-18997"},{"ord":14,"city_id":"montreal","author_nickname":"불어책갈피","tag_slug":"transport","title":"REV는 몬트리올 자전거길들을 잇는 큰 줄기네","body":"지도 색만 외우면 길을 다 알 것처럼 생각하는 버릇부터 고쳐야 할 듯 ㅋㅋ\nREV는 몬트리올 자전거길망의 중심이 되는 급행 자전거 네트워크래\n각 구의 자전거길이 여기에 연결되는 구조고, 시 지도에선 길 종류도 나눠 볼 수 있어\n겨울에도 쓰는 길이지만 제설 중엔 쌓인 눈 때문에 일부가 좁아질 수 있대\n난 코스 크게 잡기 전에 가까운 연결 구간 하나부터 알아볼까 하는 중","source":"https://montreal.ca/en/topics/cycling-and-bike-paths"},{"ord":15,"city_id":"montreal","author_nickname":"몽루아얄잎새","tag_slug":"life","title":"몬트리올 지하도시 RÉSO, 역과 쇼핑 공간이 이어지네","body":"겨울 동선 생각하다가 지하도시 RÉSO부터 살펴보고 있어\n다운타운 메트로역이랑 쇼핑 공간을 이어주는 보행 통로망이야\n건물 하나 지하상가를 말하는 게 아니라 서로 연결되는 구조라, 난 익숙한 역 주변부터 볼 거야\n처음 길 익힐 때 어느 구간이 덜 헷갈렸어?","source":"https://www.mtl.org/en/experience/guide-underground-city-shopping"},{"ord":16,"city_id":"edmonton","author_nickname":"동물그림수첩","tag_slug":"life","title":"에드먼턴 야외 운동기구, 놀이터 가까운 자리도 있네","body":"공원에서 아이 지켜보는 사람도 운동할 수 있게, 에드먼턴엔 놀이터 가까이에 운동기구를 둔 곳들이 있네\n예전엔 어른은 옆에서 기다리는 그림부터 떠올렸는데 내 운동 핑계가 하나 줄어들겠군 ㅋㅋ","source":"https://www.edmonton.ca/activities_parks_recreation/fitness-parks"},{"ord":17,"city_id":"edmonton","author_nickname":"에드먼튼겨울","tag_slug":"life","title":"옛 가게 네온사인이 에드먼턴 야외 박물관에 남음","body":"네온사인도 가게 닫으면 그냥 사라지는 건 아닌 듯\n에드먼턴 네온사인 박물관엔 복원한 옛 간판들이\n104스트리트 쪽 건물 바깥 벽에 모여 있음","source":"https://www.edmonton.ca/city_government/edmonton_archives/neon-sign-museum"},{"ord":18,"city_id":"edmonton","author_nickname":"제스퍼애비뉴","tag_slug":"life","title":"런들 공원에 원반 던지는 디스크골프 코스도 있네","body":"원반 던지는 사람 하면 반려견 놀이부터 떠올린 내가 너무 단순했나 봄\n런들 공원엔 디스크골프 코스도 있고, 일반 골프 코스랑은 별도로 소개돼 있네\n난 이름부터 헷갈리는 단계라 어느 쪽이 맞을지는 아직 못 고르겠어","source":"https://www.edmonton.ca/activities_parks_recreation/parks_rivervalley/rundle-park"},{"ord":19,"city_id":"edmonton","author_nickname":"헨데이하이웨이","tag_slug":"life","title":"퀸엘리자베스 공원 안 원주민 예술공원도 알아가는 중","body":"에드먼턴 공원은 아직 익히는 중인데, 걷는 사람 옆에 작품이 놓이는 공간도 있네\n퀸엘리자베스 공원 안에 ÎNÎW 리버롯11 원주민 예술공원이 있어\n이 땅의 역사와 이야기를 담은 조형물을 바깥 산책길에서 만나는 곳이래\n지도에서 공원 이름만 외우다 공부할 게 늘어남 ㅋㅋ 다음에 같이 걸으면 작품 얘기도 해보자","source":"https://www.edmonton.ca/activities_parks_recreation/parks_rivervalley/queen-elizabeth-park"},{"ord":20,"city_id":"edmonton","author_nickname":"헨데이하이웨이","tag_slug":"life","title":"밀너도서관 더키친은 요리를 배우는 공간이네","body":"처음엔 도서관에서 요리하는 사람 떠올리기가 좀 어려웠음\n밀너도서관의 더키친은 요리·베이킹·음식을 배우는 공간이네\n책에서 조리법 읽는 데서 끝나는 게 아니라 직접 배우는 쪽도 있는 거야\n나도 동네 알아가는 김에 이런 곳부터 기억해둘래, 같이 갈 사람한테 도서관 얘기 꺼냈다가 배고파질 듯 ㅋㅋ","source":"https://www.epl.ca/the-kitchen/"},{"ord":21,"city_id":"calgary","author_nickname":"노스힐장보기","tag_slug":"life","title":"데보니안가든은 건물 안에서 걷는 식물 공간이네","body":"데보니안가든 처음 알아보는데 실내에 나무랑 식물이 있고 온도도 조절되는 공간이네\n쇼핑 공간 위쪽에 앉을 자리도 있다니 같이 쉬기엔 괜찮을 듯한데, 갈 날은 아직 못 정했어","source":"https://www.calgary.ca/parks/devonian-gardens/features.html"},{"ord":22,"city_id":"calgary","author_nickname":"C트레인통근","tag_slug":"transport","title":"플러스15, 캘거리 건물 사이를 실내로 걷는 길이네","body":"다운타운 플러스15는 건물 사이를 잇는 지상 보행 통로망이라 바깥 날씨를 피하며 걸을 수 있겠네\n닫힌 연결 구간도 있고 운영 안내는 바뀔 수 있으니, 실제 동선 잡기 전엔 다시 확인해야겠어\n아직 구조가 머릿속에 안 잡히는데, 처음 이용할 때 어디부터 익혔어?","source":"https://www.calgary.ca/bike-walk-roll/plus-15-network.html"},{"ord":23,"city_id":"calgary","author_nickname":"컨페더레이션공원","tag_slug":"life","title":"벨트라인 로이스자보커먼스엔 야외 탁구대가 있네","body":"탁구는 공 주우러 뛰는 시간까지 운동에 넣어야 할 것 같음 ㅋㅋ\n벨트라인 로이스자보커먼스에는 콘크리트 탁구대랑 앉아서 쉬는 공간이 있네\n승부보다 가볍게 치고 쉬는 쪽이 끌리는데, 이런 야외 탁구 같이 해보면 어때?","source":"https://www.calgary.ca/parks/lois-szabo-commons.html"},{"ord":24,"city_id":"calgary","author_nickname":"보우강변산책","tag_slug":"life","title":"메모리얼파크도서관엔 악기 대여랑 연습실도 있네","body":"기타 배우려면 일단 내 악기부터 사야 한다고 생각했는데\n메모리얼파크도서관엔 기타·건반·타악기 같은 악기를 빌리는 컬렉션이 있음\n음악 연습실도 따로 있어서 악기 목록이랑 공간을 같이 볼 수 있어\n예전엔 악기 이름만 열심히 외웠는데 이번엔 소리부터 골라볼 거야, 장바구니만 연주할 순 없잖아 ㅋㅋ","source":"https://www.calgarylibrary.ca/events-and-programs/arts-and-culture/borrow-a-musical-instrument"},{"ord":25,"city_id":"calgary","author_nickname":"보우강변산책","tag_slug":"life","title":"랄프클라인공원 습지는 빗물을 처리하는 곳이기도 함","body":"물은 공원 풍경인 줄만 알았는데 랄프클라인공원에선 역할이 더 있음\n여긴 빗물을 처리하려고 만든 인공 습지 주변으로 산책길이 이어져\n자연놀이터도 산에서 습지까지 물이 이동하는 흐름을 주제로 만들었대\n어릴 때 물길 낸답시고 모래만 팠는데 이쪽은 제대로 물 공부하는 공간이네 ㅋㅋ\n다음엔 식물 이름만 보지 말고 물이 어디로 이어지는지도 볼 거야","source":"https://www.calgary.ca/parks/ralph-klein-park-activities.html"}]$GLING$::jsonb) as item(ord int, city_id text, author_nickname text, tag_slug text, title text, body text, source text);
create temporary table gling_today_author on commit drop as
select slot.city_id, slot.author_nickname,
       (select pr.id
        from public.profiles pr
        join auth.users u on u.id = pr.id
        where pr.city_id = slot.city_id
          and pr.nickname = slot.author_nickname
          and pr.account_status = 'active'
          and u.email like '%@seed.gling.invalid') as author_id
from (select distinct city_id, author_nickname from gling_today) slot;
do $$ begin
  if exists (select 1 from gling_today_author where author_id is null) then
    raise exception 'SEED_AUTHOR_NOT_FOUND';
  end if;
end $$;
insert into public.posts (author_id, city_id, tag_id, title, body, status, view_count, created_at)
select a.author_id, seed.city_id, tag.id, seed.title,
       seed.body,
       'published',
       0,
       (case when window_slot.local_time <= city_now.local_now
             then window_slot.local_time
             else window_slot.local_time - interval '1 day' end) at time zone city.timezone
from gling_today seed
join gling_today_author a on a.city_id = seed.city_id and a.author_nickname = seed.author_nickname
join public.tags tag on tag.slug = seed.tag_slug
join public.cities city on city.id = seed.city_id
cross join lateral (select now() at time zone city.timezone as local_now) city_now
cross join lateral (
  select date_trunc('day', city_now.local_now)
         + make_interval(hours => case (abs(hashtext(a.author_id::text || '-w')::bigint) % 4)
                                     when 0 then 7 when 1 then 12 when 2 then 18 else 22 end)
         + make_interval(mins => ((abs(hashtext(seed.title || '-m')::bigint) % 110) + seed.ord * 7)::int % 120)
         as local_time
) window_slot
where not exists (
  select 1 from public.posts existing
  where existing.city_id = seed.city_id and existing.title = seed.title and existing.status = 'published');

-- 작성자 성향에 맞춘 시간대는 어제가 될 수도 있다. posted_on을 그 현지 날짜로 맞춘다.
update public.posts post
set posted_on = (post.created_at at time zone city.timezone)::date
from public.cities city, gling_today seed, gling_today_author author
where city.id = post.city_id
  and seed.city_id = post.city_id
  and seed.title = post.title
  and author.city_id = seed.city_id
  and author.author_nickname = seed.author_nickname
  and post.author_id = author.author_id
  and post.posted_on <> (post.created_at at time zone city.timezone)::date;

-- 조회수는 올린 날부터 30일 동안 오른다. 1~14일차는 하루 1~30, 15~30일차는 하루 1~8. 30일이 지나면 멈춘다.
-- 올린 당일은 하루치를 경과 시간 비율로 반영한다. 나이로 목표값을 계산하므로 다시 돌려도 값이 같다.
update public.posts post
set view_count = target.views
from (
  select base.id,
         round(
           coalesce((
             select sum(1 + (abs(hashtext(base.id::text || '-' || day.i)::bigint)
                             % (case when day.i <= 13 then 30 else 8 end))::int)
             from generate_series(0, least(30, base.elapsed) - 1) as day(i)
           ), 0)
           + case when base.elapsed < 30 then
               (1 + (abs(hashtext(base.id::text || '-' || least(30, base.elapsed))::bigint)
                     % (case when base.elapsed <= 13 then 30 else 8 end))::int)
               * ((base.age_seconds - least(30, base.elapsed) * 86400) / 86400.0)
             else 0 end
         )::int as views
  from (
    select p.id,
           floor(extract(epoch from (now() - p.created_at)) / 86400)::int as elapsed,
           extract(epoch from (now() - p.created_at)) as age_seconds
    from public.posts p
    where p.status = 'published'
      and p.city_id in (select distinct city_id from gling_today)
      and p.created_at <= now()
  ) base
) target
where post.id = target.id and post.view_count < target.views;

update private.post_view_pulse pulse
set views = greatest(0, post.view_count - (select count(*) from public.post_views v where v.post_id = post.id))
from public.posts post
where pulse.post_id = post.id
  and post.city_id in (select distinct city_id from gling_today);

-- 조회 기록이 아예 없는 옛 글은 주간 랭킹에서 0으로 잡힌다. 조회수와 맞는 기록을 채운다.
insert into private.post_view_pulse (post_id, bucket, views)
select post.id, date_bin(interval '10 minutes', post.created_at, '2000-01-01'::timestamptz),
       greatest(0, post.view_count - (select count(*) from public.post_views v where v.post_id = post.id))
from public.posts post
where post.status = 'published'
  and post.city_id in (select distinct city_id from gling_today)
  and not exists (select 1 from private.post_view_pulse x where x.post_id = post.id)
  and greatest(0, post.view_count - (select count(*) from public.post_views v where v.post_id = post.id)) > 0;
insert into private.post_view_pulse (post_id, bucket, views)
select p.id, date_bin(interval '10 minutes', p.created_at, '2000-01-01'::timestamptz), p.view_count
from public.posts p
join gling_today seed on seed.title = p.title and seed.city_id = p.city_id
join gling_today_author author on author.city_id = seed.city_id
  and author.author_nickname = seed.author_nickname and author.author_id = p.author_id
where p.status = 'published'
  and not exists (select 1 from private.post_view_pulse x where x.post_id = p.id);
commit;
