# City places: simulator first

Latest owner direction: keep the main festival cards, use small previous/next controls on the card, remove the lower `다가오는 일정` heading and seven thumbnails, and put `이 도시에서 요즘 많이 가는 곳` in that lower position. Show the actual existing iPhone simulator app before any build or deployment.

Reuse the approved Luma Discover hierarchy and original Top 10 → category-filtered Top 25 → place/details/reviews/meetups direction. Reference: `/Users/ash/Desktop/Git/unknown/mobile/output/design/gling-city-discovery-entry-2026-10-12/top-places.html` and its full-flow-review.json. That artifact is a design prototype, not an implemented ranking API.

This first slice is a native layout and navigation preview: a compact borderless home entry, the current city carried into `/places`, Top 10/25 and category controls, native back navigation, and an explicit data-not-connected state. No fabricated place order, visitor counts, reviews, venue photos or paid API. The home entry is development-only until the real data path is implemented. The shared CITIES registry applies to all cities; do not add a city feature allowlist or change city preferences.

Files owned here: new city-popular-places.tsx, new app/places/index.tsx and new city-places.test.mjs. The existing live owner integrates feed-screen.tsx and owns carousel controls, HTML preview, installed simulator, Metro 8083 and the shared GUI guard. No simultaneous screen input.

Verification: `node --experimental-strip-types --test scripts/city-places.test.mjs`, `npm run typecheck`, scoped ESLint, and actual existing app reload/entry/navigation readback. Expo SDK 57 Router docs were read. Reuse current theme, 44-point targets and useInteractionFeedback for every control.

No commit, tag, native/release build, install, production migration/API deployment or submission. Real place search, recent-interest ranking, general place reviews and same-place meetups still require genuine data integration after this visual milestone. Ads stay off by default; no new job, dependency or paid provider.

## 2026-10-14 정정: 빈 미리보기 대신 실제 장소 목록

사용자가 “아무것도 안 떠”, “데이터 연결 전이라는데”라고 정정했다. 화면 배치만 연결한 이전 단계는 실제 장소 기능의 완료가 아니다. 이번 단계에서는 직접 확인한 OpenStreetMap 장소 자료를 앱에 넣어 목록·분류·검색·상세·지도 이동을 동작시킨다.

기존 두 담당자가 작업을 나눈다. 장소 API의 일회성 수집·원본 응답·질의·JSON 작성은 기존 시뮬레이터 담당자가 맡는다. 이 담당자는 홈 메뉴와 시뮬레이터도 유지한다. 루트는 city-places.ts와 places/index.tsx, places/[id].tsx, 기존 집중 검사와 이 명세를 맡는다. 새로운 작업자·계정·설치·유료 호출·서버·일정은 만들지 않는다.

자료는 src/lib/city-places.catalog.json에 수집 시간, 실제 도시 경계 relation ID, 원본 응답 SHA256, 질의, OSM node/way/relation ID, 좌표와 분류를 함께 보관한다. 공통 CITIES의 모든 도시에 같은 조회 함수를 적용하고 도시 개방 상태는 바꾸지 않는다. 동명 도시를 구분하며 오류나 부족한 결과를 예시로 채우지 않는다.

목록은 처음 10곳, 확장하거나 분류를 선택하면 최대 25곳을 보여준다. 검색은 저장한 실제 장소의 이름·주소에 한정한다. 번호와 방문자 수, 인기 점수는 만들지 않는다. 인기 순위는 아직 집계 전임을 화면에 표시한다. 일반 장소 후기와 같은 장소의 모임 연결도 이번 자료 수집만으로 완성됐다고 말하지 않는다.

상세 화면은 같은 도시의 같은 OSM ID를 사용한다. 사용자 정정에 따라 Google 지도는 좌표 대신 장소 이름·등록된 주소·도시 영문명·주·Canada로 검색한다. 주소가 없는 장소도 이름과 도시 정보로 검색하며, 기존 merchantMapsUrl과 PostMapLink를 재사용한다. OSM ID를 Google place_id에 넣지 않는다. 웹사이트는 기존 URL 검사 함수를 거치고, 출처·ODbL 이용 조건과 실제 수집 날짜를 표시한다. 데이터가 없거나 다른 도시의 ID를 받으면 오류를 표시한다.

공개 Overpass를 앱 실행 때마다 호출하지 않는다. 공식 운영 지침이 일반 앱의 실시간 백엔드 사용을 권하지 않으므로 이번에는 범위를 제한한 일회성 조회 자료를 넣는다. 자료는 실제 장소 카탈로그이며 실시간 방문·관심 집계가 아니다. 자료 갱신과 전체 도시 검증은 공개 배포 전에 다시 확인한다.

검사는 모든 CITIES의 실제 자료와 출처, 도시·분류 경계, 검색 결과 없음, 10/25 전환, 홈의 도시 유지·피드백·릴리스 접근, 실제 상세와 이름 기반 Google 지도 검색를 포함한다. 원본 수집이 끝나기 전에는 전체 도시 검사가 완료됐다고 하지 않는다. 실제 기존 시뮬레이터의 목록·상세 읽기를 완료한 뒤에 화면 연결 완료를 보고한다.

공식 출처:
- https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
- https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
- https://www.openstreetmap.org/copyright
- https://docs.expo.dev/versions/v57.0.0/sdk/router/

빌드·설치·커밋·태그·배포·심사 제출은 계속 보류한다.


## 2026-10-14 승인된 사진 UI와 배포 재개

사용자가 사진 시안을 확인한 뒤 “이대로 진행시켜”, 이어서 “이대로 배포해”라고 지시했다. 기존 보류 기록은 이전 시점의 사실로 보존하며, 현재 승인된 앱 변경의 커밋·양쪽 빌드·기존 스토어 심사 제출은 재개한다. 신규 일정·유료 서비스·중복 제출은 만들지 않는다.

메인에는 도시별 장소 사진 카드 세 개를 바로 보여주고, 전체 목록은 왼쪽 80×80 사진과 이름·분류·주소가 있는 행으로 정리했다. 목록과 상세의 뒤로 가기는 상단에 고정한다. 같은 도시·같은 OSM ID를 상세와 지도 검색에 전달하고, 모든 변경된 버튼은 기존 선택 피드백을 사용한다.

실제 OSM 장소 811곳과 확인한 Wikimedia Commons 사진 36장을 연결했다. 공통 도시 11곳 모두 사진이 있는 장소 세 곳 이상을 먼저 보여준다. 사진이 있는 장소의 표시 순서이며 인기 순위가 아니다. 사진은 촬영 시점의 자료이고, 확인한 사진이 없는 장소나 다운로드 오류에는 기본 아이콘을 보여준다. 다른 도시나 지점의 사진으로 채우지 않는다. 기존 Expo Image 캐시와 PostPhotoCredits의 출처·라이선스 안내를 재사용한다.

기존 iPhone 설치 앱과 Metro8083에서 토론토의 사진 목록·상세·출처를 직접 확인했다. 실제 DM·위치·외부 공유 전송 없이 화면을 검증한다. 전체 Node 검사 947개 중 945개 통과·실패0·조건부 생략2, 타입·전체 lint·웹 내보내기·공개/업체 번들 경계 검사를 통과했다. Android 실기기·실제 방문 인기·일반 장소 후기/모임은 이 검증에 포함하지 않는다.

이전 코드의 v1.2.1/v1.2.2 태그를 바꾸지 않고 v1.2.3으로 현재 소스를 배포한다. 기존 파이프라인이 양쪽 스토어에 사용되지 않은 빌드 번호를 배정한다. iPhone은 App Store 심사와 승인 후 출시, Android는 기존 alpha 비공개 테스트 심사로 제출한다. 각 플랫폼은 서명 빌드 검증 직후 최소 빌드 기준을 올리며, 스토어 심사 완료와 실제 설치 가능 상태는 별도로 확인한다.
