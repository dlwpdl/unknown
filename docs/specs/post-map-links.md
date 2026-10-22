# 게시글의 Google 지도 링크

2026-10-08 사용자 요청: 장소 소개 글에서 Google 지도로 바로 연결한다.

- 글쓰기에서 Google 지도 공유 링크를 선택적으로 입력한다.
- 링크는 기존 본문의 `Google 지도: https://…` 별도 줄로 저장한다. 기존 글과 저장 API를 유지하며, 지도 링크가 없으면 기존 동작을 따른다.
- 피드·상세·공개 웹에서 지도 줄 대신 `Google 지도에서 보기`를 표시한다. 업체가 본문에 붙인 지도 링크도 같은 방식으로 표시한다.
- 일반 Google 지도 장소/검색 주소, 캐나다·한국 주소, Google의 지도 공유 주소를 허용한다. HTTPS·허용 도메인·경로를 검증하며 로그인 정보가 포함된 URL은 거부한다.
- 본문과 링크를 합친 4000자 제한, 원본 본문, 게시·모임 권한, 안전 분석과 버튼 피드백을 유지한다.

구현: `src/lib/post-maps.ts`, 공용 게시글 카드, 글쓰기, 공개 웹. 기존 `Linking.openURL`, 테마, 행동 분석 버튼을 사용한다. 지도 API 키·지도 임베드·외부 지오코딩은 필요 없다.

검증: `node --experimental-strip-types --test scripts/post-maps.test.mjs`, `npx tsc --noEmit`, `npm test`, 실제 컴포넌트 HTML 시안. 기존 게시글을 검증 목적으로 새로 게시하거나 실제 모임 신청을 취소하지 않는다.

Google 공식 문서: https://developers.google.com/maps/documentation/urls/guide
