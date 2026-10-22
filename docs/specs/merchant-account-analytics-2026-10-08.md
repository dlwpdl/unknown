# 업체 계정 연결과 GA4 클릭 측정

2026-10-08 소유자 지시: 업체 소개글에서 업체 계정으로 연결하고, 업체별 클릭 성과를 이후 유료 운영 제안에 사용한다. 기존 업체 관리·버튼·집계를 확장한다.

## 범위와 성공 기준

- 앱 상세와 공개 웹 상세의 기존 외부 링크를 업체 계정 버튼으로 표시한다. 44px 터치 영역, 외부 이동 안내, 기존 `play('selection')` 피드백과 실패 처리를 유지한다.
- 2026-10-08 후속 지시: 비즈니스 카테고리로 제한하지 않는다. 맛집·라이프 등 어느 카테고리든 업체에 연결하고 소개·홍보 허락을 기록한 글에 버튼을 붙인다. 일반 후기에는 자동으로 업체를 연결하지 않는다.
- 추가 지시: 구인구직·중고거래 카테고리는 공통 목록의 마지막 두 칸에 둔다. 기존 가로 스크롤 첫 화면에서는 앞쪽 생활·문화 주제만 보이고, 글쓰기와 검색에서는 두 분류도 선택할 수 있다. 기존 글을 재분류하거나 카테고리로 거래 정책을 바꾸지 않는다.
- 밴쿠버 OFY,OFT와 The Green의 기존 게시글 ID를 유지하고 허락받은 공식 Instagram 계정에 연결한다. 활성 무료 소개 상태이며 결제·메시지 발송은 추가하지 않는다.
- 기존 `record_merchant_source_click`에서 실제로 저장된 새 클릭만 서버에서 GA4 `merchant_account_click`으로 전달한다. 관리자·작성자·시드 제외, 중복 UUID 방지, 동의 철회·게시 중단·도시 검증을 재사용한다.
- GA4에는 업체 ID·공개 업체명·글 ID·도시·플랫폼과 임시 세션의 해시만 전송한다. 사용자 계정 ID·연락처·입력값·본문·사진·좌표·전체 URL·기기 광고 식별자를 전송하지 않는다. Google 광고 개인화와 광고 사용자 데이터 공유를 끈다.
- API secret은 기존 Supabase Vault에서만 읽는다. Google 장애나 미설정 상태에서도 자체 클릭 저장과 외부 이동은 작동한다. 기존 pg_net 비동기 HTTP를 사용한다.
- 업체별 기간 보고서의 클릭 수·로그인 고유 회원·익명 세션은 기존 서버 집계가 기준이다. 클릭은 문의·주문·매출·유료 구매 증명이 아니며 GA4의 임시 세션 수를 사람 수로 제안하지 않는다.

## 구현·검증

Expo 57·React Native·Supabase를 그대로 사용한다. 변경 위치는 기존 업체 버튼/공개 reader, 업체 보고서 문구, 개인정보 안내, SQL migration과 기존 pgTAP 검사다. 추가 SDK·서버·예약 작업은 없다.

순서: 기존 두 글 연결 확인 → SQL 회귀 검사 실패 확인 → INSERT trigger 적용 → 로컬 SQL/타입/단위 검사 → Google 속성·stream·맞춤 측정기준 구성 → 운영 설정·웹 반영·검증. 기존 작업의 변경은 보존한다.

스타일: `void trackMerchantSourceClick(supabase, postId, Platform.OS);`처럼 측정을 이동 전에 비동기로 시작하며 이동을 기다리게 하지 않는다.

검사: `npm test`, `npx tsc --noEmit`, `npx --no-install supabase test db supabase/tests/merchant_management.test.sql`, `npm run export:web`, `npm run check:public-web`. Google Measurement Protocol 검증 endpoint는 실제 성과를 만들지 않는다. 실제 전송 확인용 QA 이벤트는 별도로 표시·제외하며 업체 성과 원자료에는 넣지 않는다.

안전 경계: 업체 변경은 기존 AAL2 관리자 RPC, 서버 배포·Vault 설정은 기존 관리 경로. 개인 정보나 자격 증명을 Git·로그·클라이언트 번들에 넣지 않는다. 기존 자동화 일정과 미완료 제출을 바꾸지 않는다. 네이티브 화면 배포와 서버/웹 배포의 완료 상태를 구분한다.

화면 참고: [Tripadvisor 소개 아래 상세 버튼](https://mobbin.com/screens/c1bd14ce-3fd2-4080-9531-ccc9386b2404), [Fresha 업체 정보와 주요 동작](https://mobbin.com/screens/e3a593d6-df18-42fe-a403-da9fb695e7d2). 현행 글링 night 색상과 버튼 구조를 유지한다.

공식 구현 근거: [GA4 Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events), [이벤트 검증](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/). 이 측정은 업체 버튼 클릭 이벤트에 한정하며 Firebase 앱 전체 행동 분석·광고 기여도 측정은 범위에 포함하지 않는다.
