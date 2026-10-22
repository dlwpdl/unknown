# 글의 장소 표기와 위치 첨부 — 2026-10-12

사용자 요청: 모든 글에 영문 지명을 강제하지 않고 작성자별로 한글·영문을 자연스럽게 섞는다. 글쓰기에서 장소를 넣어 정보·업체 홍보 글에 Google Maps 위치를 공유한다.

## 동작

- 기존 운영 캐릭터 v4의 다른 설정은 그대로 두고 `voice.place_name_language`를 `ko` 또는 `en`으로 한 번 배정한다. 기존 값은 유지한다. 한글 성향에서도 익숙한 브랜드·약자는 억지로 번역하지 않는다.
- 자동 원고의 `place_name`과 주소는 검증된 공식 로마자 지도 검색어다. 한국어 본문은 `place_display_name`과 연결한다. 표기 변화가 장소·시간·요금·의미를 바꾸지 않는다. Patina와 출처 대조를 같은 작성 에이전트에서 수행한다.
- 글쓰기와 글 수정의 기존 `PostBodyEditor`에 선택 항목인 위치 첨부를 넣는다. 장소명·주소를 입력하거나 Google Maps HTTPS 공유 링크를 붙인다. 저장 전 지도 열기, 위치 교체·삭제, 취소 시 기존 글 보존을 지원한다.
- 일반 장소 입력은 게시 도시를 포함한 Google Maps 검색 링크를 만든다. 검색 결과를 특정 좌표나 검증된 핀으로 표시하지 않는다. URL처럼 보이는 잘못된 입력은 장소 검색으로 바꾸지 않는다.
- 기존 본문 지도 마커와 지도 버튼을 재사용한다. 외부 첨부 링크와 지도는 본문 수정 때 유지하며 지도 삭제는 다른 첨부를 지우지 않는다. 본문·지도 합계 4,000자 한도, 안전한 URL 검사, 기존 권한과 피드백을 유지한다.
- 오늘 큐는 실제 제출·저장 기록을 먼저 확인하고 아직 제출되지 않은 행만 교정한다. 기존 게시·미확인 요청·원래 게시 시각은 유지한다. 정상 발행기를 직접 실행하지 않는다.

## 범위와 구현 순서

1. 기존 `profile-personas.py`와 `city-post-schedule.py`에 한 번 배정되는 표기 성향과 본문 표시 이름 연결을 추가하고 기존 검사로 검증한다.
2. 오늘 미제출 원고를 같은 장소·사실로 교정하고 기존 큐와 native G6 지침을 재조회한다.
3. `post-maps.ts`, `PostBodyEditor`, FeedScreen과 글 수정 호출자를 연결한다. 이미 있는 링크 모달, 지도 버튼, 나이트 테마, `useInteractionFeedback().play`를 재사용한다.

새 DB 스키마·지도 SDK·유료 Places API·자동화·게시 시간 변경은 필요하지 않다. 현재 앱 소스의 다른 수정은 작업 기준으로 보존하고 이 기능의 변경분만 반영한다.

## 검증

`python3 scripts/profile-personas.test.py`, `python3 scripts/city-post-schedule.test.py`, `node --experimental-strip-types --test scripts/post-maps.test.mjs`, `npm test`, `npx tsc --noEmit`, 변경 파일 lint. 원래 실패를 먼저 기록하고 신규 로직은 실패하는 동작 검사부터 추가한다. HTML 시안과 실제 위치 추가·교체·삭제의 렌더 검사를 남긴다.

## 디자인 근거

Apple Design의 선택권·명확한 레이블·44px 조작 영역·즉시 피드백. Mobbin에서 Instagram 위치 선택·본문 아래 위치 추가 화면을 실제 확인했다: https://mobbin.com/screens/d2e52d68-be42-4e19-b938-ce25f7a0eb82 및 https://mobbin.com/screens/f4044b96-db05-4bea-ab72-a214107b1da1 . BrandKit product 색은 현재 `#0B0B12`/`#CBB9FF`와 일치한다. Pinterest 결과는 이 입력 흐름의 직접 근거로 채택하지 않았다. Kroma는 인증 키가 없어 결과를 확인하지 못했다.

## 구현 확인

기존 글쓰기·글 수정·글링 업체 초안에 위치 입력을 연결했다. 전체 앱 검사 785개 중 784개 통과·1개 건너뜀·실패 0개, 타입 검사와 변경 파일 lint 통과. 실제 편집 컴포넌트로 장소 입력·공유 링크·교체·취소·삭제·길이 제한·첨부 보존 흐름을 확인했다. 390px 폭의 시안 버튼은 44px 이상이고 위치 모달 입력 포커스를 확인했다. 스토어 배포와 실기기 키보드·촉각 피드백은 아직 확인하지 않았다.

원고 교정 직후 기존 5개를 보존했으며 10:37 밴쿠버 시각 조회에서 총 6개 게시·19개 대기를 확인했다. 교정된 캘거리 교통 글의 제목·본문·작성자·도시가 실제 저장 결과와 일치했다. 독자 반응이나 전환 효과는 아직 측정하지 않았다. 상세 증거: /Users/ash/Library/Application Support/gling/operations/post-location-20261012/completion.json .


## 2026-10-12 사용자 후속 정정 — 지도에서 핀 선택

사용자는 텍스트 위치 입력 시안을 원하던 방식으로 받아들이지 않았다. 위치 공유 버튼에서 Google Maps·Apple Maps 같은 지도 화면이 열리고, 선택한 핀 위치를 바로 글에 첨부하는 흐름을 원한다. 이 회차는 디자인 레퍼런스 조사 요청이다. 실제 Telegram·Google Maps·Apple Maps 화면 5개를 확인하고 원본 이미지와 링크를 `output/design/gling-pin-location-references-20261012/`에 저장했다. Telegram의 지도·선택 핀·하단 Send Location 구성이 가장 가깝다. 앱 안에서 지도 선택 → 선택 지점 고정 → 글에 지도 카드 첨부를 다음 디자인 기준으로 한다. 외부 지도 앱을 여는 링크만으로 선택한 핀을 자동으로 돌려받는다고 가정하지 않는다. 기존 텍스트 입력 구현을 핀 선택 연동 완료로 취급하지 않는다. 이 회차에서 앱 소스·SDK·게시 일정·스토어 배포는 변경하지 않았다.


## 같은 회차 비용·오픈소스 지도 조사

사용자는 지도 API 비용과 탈취된 키의 과다 호출을 우려하고 무료 오픈소스 지도 도구를 먼저 조사하도록 정정했다. 결제 계정·Google Maps API 키·유료 Places 기능은 설정하지 않았다. Google/native MapKit 핀 선택 초안은 격리 작업 트리에 보존했고 원본 앱에 반영하지 않았다.

Leaflet + OpenStreetMap는 현재 설치된 WebView를 재사용하는 최소 후보이며, MapLibre React Native는 iOS·Android native 후보다. 도구와 지도 데이터는 오픈소스/무료여도 타일·검색 서버의 운영 비용과 사용 조건은 별개다. OSM 공용 타일은 출처 표시·식별·캐시·중량 사용 제한과 SLA 없음 조건을 확인했다. 공용 Nominatim의 자동완성/일반 AI 도구 연동 제한을 확인해 무제한 검색 서비스로 제안하지 않는다. Photon 공용 demo의 fair use/서비스 보장 없음도 구분한다. 좌표 공유는 기존 Google Maps URL로 만들 수 있고 이 URL에는 API 키가 필요하지 않다.

조사 근거: /Users/ash/Library/Application Support/gling/operations/google-pin-picker-20261012/open-source-map-research.json . 현재 결과는 후보 조사이며 새 타일·검색 공급자의 실제 앱 통합 완료를 의미하지 않는다.
