# 도시 선택 확장 — 2026-09-12

사용자 요청: 오타와 ON, 에드먼튼 AB, 리자이나 SK, 세인트존 NB, 할리팩스 NS를 추가한다. 후속 확인에 따라 **신규 캐나다 도시 모두 준비 중**이고, 미국은 준비 중인 비활성 국가 탭이다. 기존 밴쿠버·토론토만 이용 가능 상태를 유지한다.

NB로 지정했으므로 [Saint John 시](https://saintjohn.ca/en)를 기준으로 한다. [St. John's](https://www.stjohns.ca/about-st-johns/history-and-archives/historical-timeline/)는 Newfoundland and Labrador의 다른 도시다. 화면에 영문명과 주 약자를 함께 보여 혼동을 줄인다.

`apple-design` 적용: 기존 네이티브 iOS pageSheet/Android 모달, 종이 배경·인주색·시스템 글꼴을 유지한다. 국가 분류는 상단의 작은 세그먼트, 그 아래 도시·주 검색, 목록은 이용 가능/준비 중으로 구분한다. 도시마다 큰 카드를 추가하지 않고 높이가 유동적인 행을 사용한다. 최소 44pt 터치 영역, 검색 키보드 대응, 선택·비활성 접근성 상태를 유지한다.

확장 원칙: 당장은 캐나다 11개 도시를 같은 목록에서 찾는다. 추가 도시는 카탈로그 항목으로 늘리고, 미국 서비스를 실제로 열 때 국가 선택 동작과 도시 데이터만 연결한다. 주 목록을 한 단계 더 거치는 탐색은 현재 규모에서 필요하지 않다. 준비 중 지역은 선택/저장/GPS 추천을 열지 않으며 오픈 일정이나 회원 수를 만들지 않는다.

근거: [Apple Searching](https://developer.apple.com/design/human-interface-guidelines/searching)의 검색 범위, [UIKit 세그먼트 비활성 상태](https://developer.apple.com/documentation/uikit/uisegmentedcontrol/isenabledforsegment(at:))를 확인했다. BrandKit에는 Gling 항목이 없어 현재 앱 토큰을 따른다. Mobbin의 [Singapore Airlines 도시 검색](https://mobbin.com/screens/64e00cdf-58e8-494d-aa72-e4fa1849ba04)은 도시명과 보조 지역 정보를 분리하며, [Trip.com 지역 선택](https://mobbin.com/screens/864a3891-dc58-4c61-82ff-5f696db126c8)은 국가별 목록을 나눈다. 둘의 실제 이미지를 참고했다. The Infatuation의 칩 목록은 도시 수·긴 한국어 이름에 덜 적합해 채택하지 않았다. Pinterest는 보조 검색으로만 사용했고 Kroma는 API 키가 없어 결과를 받지 못했다.

구현: `CITIES`에 준비 중 도시와 영문명을 추가하고 기존 도시 모달의 내용만 `CityPicker`로 옮긴다. 공통 `selectCity`에서 카탈로그의 open 상태를 검사해 준비 중 도시가 다른 호출 경로로 저장되는 것도 막는다. 관리자 분석도 같은 카탈로그를 필터로 사용하고 RPC가 DB의 도시 존재 여부를 검사하므로, migration `0039`로 `public.cities`에도 신규 5개 도시를 `is_open = false`로 등록한다. 새 DB 구조는 추가하지 않고 실제 서비스 지역, 회원 선호 지역과 GPS 좌표를 변경하지 않는다.

검증: 기존 저장/계정 전환 회귀 검사에 준비 중 선택 차단을 추가한다. 검색(한국어/영어/주 코드), 빈 결과, 미국/준비 중 도시 비활성, 현재 도시 선택 표시, 검색 초기화와 큰 글씨 레이아웃을 확인한다. `npm run typecheck`, `npm run lint`, `npm test`, 공개 웹 export와 관리자 제외 검사, 네이티브 시뮬레이터 확인을 실행한다.

결과: typecheck/lint 및 Node 검사 90개, 로컬 DB 카탈로그 pgTAP 20개 통과. 공개 웹 export 관리자 제외 검사 통과. 0039만 원격 적용 후 11개 도시 중 밴쿠버/토론토만 open인 것을 재조회했다. 관리자 export를 갱신하고 54321의 별도 로그인 탭에서 오타와 필터를 선택해 오류 없이 조회되는 것을 확인했다. QA 탭은 닫고 기존 사용자 탭은 유지했다.

iOS Release 빌드와 실제 시뮬레이터에서 준비 중/미국 선택 차단, 오타와 검색, 선택한 밴쿠버 유지, 닫았다 열면 검색 초기화까지 검증했다. 실행 중 Dynamic Type을 최대 접근성 크기로 바꾸면 기존 네이티브 글자 레이아웃이 갱신되지 않는 현상을 발견해 `useWindowDimensions().fontScale`에 따라 시트 내부를 다시 배치하도록 수정했다. 제목도 `지역 선택`으로 줄여 큰 글씨에서 도시 목록 공간을 확보했다. 최대 글씨 재검증 후 원래 크기로 복원했다. 원본 화면과 최종 설치본 SHA-256은 `output/qa/city-selector-2026-09-12/provenance.json`에 기록했다. 이 변경은 아직 스토어 배포본에 포함되지 않았다.
