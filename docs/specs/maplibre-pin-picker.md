# MapLibre 위치 공유 · 2026-10-12

사용자가 두 실제 지도 시안을 확인하고 “맵 리브레 ㄷ써”로 MapLibre를 선택했다. 선택한 전체 지도·떠 있는 위치 카드의 흐름을 앱에 반영한다. 기존 Google SDK 초안은 이번 선택으로 대체하며 결제 계정·Google Maps 키·Places API를 설정하지 않는다.

기존 react-native-webview 13.16.1에서 고정 MapLibre GL JS 5.24.0을 로컬 번들로 실행한다. OpenFreeMap Liberty 스타일·OpenStreetMap 데이터를 사용한다. 새 앱 의존성/네이티브 SDK/DB/서버/예약 작업은 추가하지 않는다. 공개 지도 서비스의 가용성 보장은 없다.

위치 공유 → 큰 지도 → 지도 터치/POI/핀 드래그 또는 명시적인 내 위치/주소 검색 → 이름 확인 → 위치 첨부 → 지도 카드 → Google Maps 좌표 URL. 취소 시 기존 본문·사진 출처·SNS·첨부를 보존한다. 일반/비즈니스 글쓰기와 편집의 기존 호출자를 사용한다. 웹에서는 지도 핀과 내 위치를 지원하며 주소 검색은 네이티브 OS 지오코더만 사용한다. 예시 검색 데이터를 제품에 넣지 않는다.

GPS는 명시적 버튼에서만 foreground one-shot이고 정확도/나이/모의 위치 검사와15초 제한을 재사용한다. 취소·수동 핀 변경·백그라운드 진입 후 늦은 GPS/주소 결과는 버린다. 도시 추천 동의나 원장·서버 위치 수집을 켜지 않는다. 안드로이드 주소 검색은 OS의 전경 권한이 없으면 안내하고 수동 핀을 유지한다.

MapLibre HTML은 로컬 고정 SDK 코드와 안전한 숫자 설정만 포함한다. 네트워크는 OpenFreeMap HTTPS로 제한한다. WebView/iframe 메시지의 길이·타입·좌표와 출처를 검사하고 지도에 인증 토큰을 보내지 않는다. 출처 링크는3개 공식 URL만 허용한다. 지도 카드의 비대화형 미리보기는 실제 렌더를 이미지로 바꿔 WebGL 컨텍스트를 해제하고24개까지만 메모리 재사용한다.

파일: src/lib/post-maps.ts, src/lib/post-map-html.ts, assets/maps/maplibre.js 및 라이선스, src/components/post-pin-map.tsx, post-location-picker.tsx, post-body-editor.tsx, post-map-link.tsx, post-card.tsx, feed-screen.tsx, public-web/reader.tsx, i18n/ko.ts, scripts/post-maps.test.mjs, scripts/maplibre-map.test.mjs. 현재 루트와 격리 작업 트리의 바뀐 파일을 대조하고 이번 변경만 반영한다. 다른 작업의 package/config 수정은 보존한다.

검사: node --experimental-strip-types --test scripts/post-maps.test.mjs scripts/maplibre-map.test.mjs; npx tsc --noEmit; npm test; npm run lint; 실제 MapLibre HTML/React 위치 선택기의 선택·첨부·취소·원문·4000자·권한·늦은 응답 검사; 원래 Git→gling Orca 탭에서 실제 화면 확인. 설정/코드 반영과 실제 iOS/Android 빌드·GPS·스토어 출시를 구분한다.

공식 계약: Expo57 WebView/Location 문서, 고정 MapLibre GL JS 패키지와 Map/Marker API, OpenFreeMap quick_start 및 공개 서버 조건. 기존 Mobbin Telegram/Google Maps 실제 화면과 승인된2안·나이트 테마를 재사용한다. 공개·유료 권한은 확대하지 않는다.

현재 실제 소스: 일반/비즈니스/편집과 공개 읽기의 기존 본문/링크 경로를 유지하며, 위치 이름/좌표와 지도 이미지를 연결했다. 개인정보처리방침에는 선택해 게시한 핀과 도시 추천용 비공개 기록을 구분하고 OpenFreeMap 지도 요청을 안내한다. 기존 안전 분석/접근/30일 삭제는 유지한다. foreground 권한 문구만 지도 공유 목적을 포함해 보완했고, 기존 출시 구현의 prebuild가 이 문구를 적용한다. 새 키/결제/SDK 의존성/DB/자동화/공개 제출은 없다.

2026-10-12 카드 크기 검토 뒤 사용자가 “좋다”, “이대로진행해”로 축소 시안을 승인했다. 첨부 카드는64×64 지도 옆에 장소명과 Google 지도 열기를 묶고, 출처 표시는 썸네일 밖의12px 글자로 유지한다. 카드 전체 링크·선택 피드백과 긴 이름/큰 글자에 따른 자연스러운 높이 증가를 유지한다. 썸네일 오류 시 짧은 지도 표시로 외부 링크를 계속 쓸 수 있고, 전체 지도 선택기의 기존 오류/재시도는 유지한다. 위치 선택 하단 카드는 중복 제목과 숫자 좌표를 빼고, 이름 편집·공개 안내·48 높이의 첨부 버튼을 유지한다. 고정 높이로 글자를 자르지 않는다. 승인 비교 자료: output/design/gling-location-card-size-20261012/index.html.
