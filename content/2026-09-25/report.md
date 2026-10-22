# 2026-09-25 도시 게시글 작업 결과

**원고 25건 준비 / 등록 0건. 무과금 조건 때문에 등록·STAGE를 보류함.**

- 밴쿠버·토론토·몬트리올·에드먼턴·캘거리: 원고 각 5건, 등록 각 0건
- 등록 시각 범위: 없음
- 댓글 0건, 글쓴이 답글 0건. 등록 후 댓글 수·comment_count 검사는 미실행
- SNS 발행·예약, 유료 호출, DB 쓰기, 자동화 변경 없음
- 원고: [draft/posts.json](draft/posts.json) / 상세 검증: [report.json](report.json)

## 보류 근거

1. 운영 DB의 새 글 안전검사 트리거와 매분 검사 cron이 활성 상태다. 배포된 safety-monitor 코드에도 유료 OpenAI Responses API와 gpt-5-mini 호출이 존재한다. 로컬 등록도 이 서버 후속 처리를 유발할 수 있다. 운영 문서의 무비용 설명만으로 등록하지 않았다.
2. 현재 스크립트는 댓글·답글을 만들지 않는다. 직접 작성·자동화 수정은 사용자 금지 범위다.
3. 현재 스크립트를 그대로 실행할 경우 검증 당시 예상값은 현지 9/24 15건·9/25 10건이었다. 예정 시각은 25개 모두 다르지만 실제 등록 시각은 아니다.

예약 스크립트가 원본 posts.json도 먼저 읽으므로 정식 경로와 예약용 사본 대신 별도 draft 경로에 저장했다. STAGE=1·GROW=1 실제 실행은 하지 않았고, 별도 원고를 지정한 DRY_RUN=1 SQL 생성만 확인했다.

## 원고 검증

도시별 건수, 제목·첫 단어 중복, 작성자 도시·활성·시드 상태, 본문 링크/출처/Threads 호칭 제외, 프로필 발화량, 도시별 질문·확인 안내 상한을 통과했다. 운영 DB 재조회에서 해당 도시·제목 일치는 0건이었다. 기존 글이 있는 프로필 7명은 이력을 대조했고, 나머지 18명은 기존 게시글이 없어 과거 글투 대조와 프로필 2건 기준을 충족하지 못한다.

## 확인한 공식 안내

모두 2026-09-25 직접 열어 본문을 확인했다. 행사 당일 개최나 모든 시설의 당일 개방을 의미하지 않으며, 미확인 일정·가격은 원고에 넣지 않았다.

| 도시 | 원고 | 공식 안내 |
|---|---|---|
| vancouver | MOA에서 로브 작품 전시가 열리고 있네 | [공식 페이지](https://moa.ubc.ca/visit/) |
| vancouver | 비티 박물관, 전시랑 연구가 같이 있는 곳임 | [공식 페이지](https://beatymuseum.ubc.ca/visit/) |
| vancouver | UBC 식물원이랑 니토베 정원은 다른 공간이네 | [공식 페이지](https://botanicalgarden.ubc.ca/visit/) |
| vancouver | Iced In은 북극에서 살아온 지식을 다루는 전시네 | [공식 페이지](https://vanmaritime.com/explore/exhibits/iced-in/) |
| vancouver | 버스에서 큰 가방은 어디에 두는 게 편해? | [공식 페이지](https://www.translink.ca/rider-guide/etiquette-on-transit) |
| toronto | 강아지 산책도 뛰는 공간이 따로 있구나 | [공식 페이지](https://www.toronto.ca/community-people/animals-pets/pets-in-the-city/dogs-in-the-city/) |
| toronto | 토론토 공공미술 지도에 조각이랑 벽화가 같이 있네 | [공식 페이지](https://www.toronto.ca/explore-enjoy/history-art-culture/public-art/) |
| toronto | 앨런가든 온실, 유리 지붕부터 눈이 가네 | [공식 페이지](https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/gardens-and-horticulture/conservatories/) |
| toronto | 리버데일 팜도 시내 나들이 후보에 넣었어 | [공식 페이지](https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/zoos-farms/) |
| toronto | 지금 사는 동네의 옛 사진을 찾아보고 싶어 | [공식 페이지](https://www.toronto.ca/city-government/accountability-operations-customer-service/access-city-information-or-records/city-of-toronto-archives/whats-in-the-archives/photographs/) |
| montreal | 라퐁텐 공원의 긴 풀에도 이유가 있었네 | [공식 페이지](https://montreal.ca/en/places/parc-la-fontaine) |
| montreal | 테니스 처음 배우는 쪽도 찾아보는 중 | [공식 페이지](https://montreal.ca/en/topics/tennis) |
| montreal | 몬트리올 소음 규정은 구마다 다르네 | [공식 페이지](https://montreal.ca/en/topics/noise) |
| montreal | 프레데릭백 공원, 매립지였던 땅이래 | [공식 페이지](https://montreal.ca/en/places/parc-frederic-back) |
| montreal | 래그위드랑 포이즌아이비를 같은 풀로 생각했음 | [공식 페이지](https://montreal.ca/en/eliminating-ragweed) |
| edmonton | 퀸엘리자베스 공원 안에 원주민 미술 공간이 있네 | [공식 페이지](https://www.edmonton.ca/activities_parks_recreation/parks_rivervalley/queen-elizabeth-park) |
| edmonton | EPL에서 클래식 음악도 들을 수 있었음 | [공식 페이지](https://www.epl.ca/resources/) |
| edmonton | 남는 공예 재료, Reuse Centre 품목부터 봄 | [공식 페이지](https://www.edmonton.ca/programs_services/garbage_waste/reuse-centre) |
| edmonton | 테니스 코트에선 기다리는 사람도 신경 쓰이겠네 | [공식 페이지](https://www.edmonton.ca/activities_parks_recreation/tennis-courts) |
| edmonton | 런들 공원은 실내 공간도 같이 있네 | [공식 페이지](https://www.edmonton.ca/activities_parks_recreation/parks_rivervalley/rundle-park) |
| calgary | 쇼핑센터 안 정원이라니 아직 신기함 | [공식 페이지](https://www.calgary.ca/parks/devonian-gardens.html) |
| calgary | 잉글우드 보호구역은 철새가 쉬는 곳이네 | [공식 페이지](https://www.calgary.ca/parks/inglewood-bird-sanctuary.html) |
| calgary | 반려동물 입양, 시 보호소도 있구나 | [공식 페이지](https://www.calgary.ca/pets/adoption.html) |
| calgary | 비상계획에 반려동물도 같이 들어가네 | [공식 페이지](https://www.calgary.ca/emergencies/preparedness.html) |
| calgary | 캘거리 교통카메라는 녹화 영상이 아니네 | [공식 페이지](https://www.calgary.ca/roads/conditions/traffic-cameras.html) |
