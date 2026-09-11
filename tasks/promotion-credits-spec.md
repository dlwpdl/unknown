# 홍보 크레딧 구현

2026-09-10. 사용자가 승인한 홍보 전용 재화·충전/홍보 분리 방향을 구현한다. `relationship-slots-and-promotion-2026-09-10.md`의 관계 정책은 유지한다.

## 최신 사용자 결정: 출시에서는 제외

구현은 개발용으로 보관하고 사용자에게 노출하지 않는다. 관계 슬롯·수락 규칙을 포함한 새 앱 빌드의 심사·출시를 우선한다. 메뉴·자기 글 버튼·직접 URL 모두 개발 모드와 명시적 `EXPO_PUBLIC_PROMOTIONS_PREVIEW=1`일 때만 활성화한다. Release 빌드는 환경변수가 있어도 노출하지 않는다. 홍보 상품 등록·실제 구매·운영 마이그레이션/송출은 보류한다. 피드 삽입은 이번 출시 범위에서 제외한다.

## 범위와 가정

- 회원 계정에 구매한 홍보 크레딧을 보관하고, 게시한 자신의 글을 골라 사용한다. 게시 자체와 크레딧 구매는 분리한다. 송금·현금화·만료는 없다.
- 900/1,700 크레딧 패키지와 1크레딧=유효 추가 홍보 노출 1회로 준비한다. 이는 사용자의 노출 수 예시를 구현 단위로 채택한 것이며 판매 가격 승인이 아니다. 실제 스토어 가격/상품이 없으면 구매 준비 중으로 표시한다.
- 충전은 기존 RevenueCat 검증 webhook만 인정한다. Supabase가 구매별 잔여 크레딧과 캠페인 배정을 한 트랜잭션에서 관리한다. RevenueCat 별도 잔액과 이중 차감하지 않는다. 구매별 환불과 이미 제공한 홍보를 정확히 연결하기 위한 최소 장부다.
- 거래 ID 중복·다른 계정의 같은 구매 재사용·동시 차감·역순 환불·테스트 잔액의 실제 홍보 사용을 차단한다. 환불된 구매로 구성된 캠페인은 중단하고, 다른 정상 구매의 미사용 배정은 지갑으로 반환한다. 이미 제공한 노출을 다시 과금하지 않는다.
- 홍보는 로그인한 같은 도시 사용자 피드에 한 자리로 제공한다. 자연 노출은 차감하지 않는다. 홍보 카드가 50% 이상 1초 연속 보인 경우 보고한다. 서버 발급 배정 토큰·만료·자기글 제외·계정별 캠페인당 24시간 중복 제한을 검증한다. 클라이언트 시야 보고만으로 악성 변조/봇을 완전히 판별할 수 없으므로 실제 판매 전 실제 송출 검증이 필요하다.
- 테스트 구매 잔액은 별도로 표시하며 일반 피드에 송출하지 않는다. 운영 설정은 기본 비활성. 스토어 가격 확정 및 실제 sandbox 구매 검증 전 판매/송출을 켜지 않는다.
- 실제 관계 슬롯 API가 준비되면 시작 직전 가용 수를 확인하고 0개일 때 안내 후 명시적 계속을 허용한다. 기존 일일 대화 한도를 가용 슬롯으로 오인하지 않는다. 아직 미연결이면 확인 준비 중으로 표시한다.

## 기존 구조와 구현 순서

Expo 57 / React Native / react-native-purchases / Supabase를 재사용한다. 새 의존성은 없다.

1. `supabase/deferred/0032_promotion_credits.sql`: 구매·배정·실제 노출 장부, RLS와 서비스 전용 지급, wallet/start/pause/serve/record RPC.
2. `supabase/functions/_shared/promotions.ts` 및 기존 membership webhook: 검증한 홍보 상품 이벤트를 멤버십 이벤트와 분리하고 영속 저장 실패 시 재전송 요청.
3. `src/lib/promotions.ts`, `src/app/profile/promotions.tsx`: 지갑·스토어 충전·자신의 게시글 홍보·내역, 프로필과 자신의 글에 진입점.
4. 피드 홍보 카드의 실제 가시성 보고. 현재 공개 피드 정렬/자연 조회는 변경하지 않는다.

## 스타일과 보안 경계

기존 함수 스타일을 따른다: `const result = await client.rpc('get_promotion_wallet'); if (result.error) throw result.error;`.

- 항상: 계정/글 소유권 확인, 서버 고정 상품 수량, 구매별 불변 거래 식별자, 잠금 순서 통일, 모든 금액/수량 검증, 계정 변경 시 UI 이전 잔액 제거, 안전 운영 ADR 보존.
- 현재 범위: 로컬 코드·DB 테스트·화면 검증. 판매가와 스토어 설정은 실제 값 확인 후 진행. 사용자 입력이 필요한 정산/세금은 임의 입력하지 않는다.
- 금지: 클라이언트의 결제 성공/지급량 신뢰, 비밀키 앱 탑재, 생산 계정에 테스트 잔액 혼입, 새 구매로 환불 손실 몰래 회수, 임의 만료/가격 등록.

## 검증

`node --experimental-strip-types --test scripts/promotions.test.mjs scripts/membership-webhook.test.mjs`

`npx --no-install supabase db query --local --file supabase/deferred/0032_promotion_credits.sql`로 로컬 개발 DB에만 적용한 뒤 `npx --no-install supabase test db supabase/deferred/promotion_credits.test.sql`

`npm run typecheck`, `npm run lint`, `npm test`, `npx --no-install supabase test db`

상태 전이와 실제 DB/RPC 결과를 검사한다. 운영 상품 미연결·슬롯 미연결은 성공으로 처리하지 않는다. Orca는 Git → gling 폴더에서 확인한다.

홍보 SQL과 DB 검사는 `supabase/deferred/`에 보관하여 정규 출시 마이그레이션과 자동 배포에서 제외한다. 새 관계 슬롯 마이그레이션 `0033`은 홍보 테이블 없이 독립적으로 동작한다. 개발용 지급 웹훅 코드도 서버 설정이 없으면 동작하지 않는다.
