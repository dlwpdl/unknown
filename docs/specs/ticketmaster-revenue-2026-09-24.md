# Ticketmaster 수익 숫자 화면

## 승인 범위 / 목표
2026-09-24 사용자: 행사 발견 → 글링 모임 → Ticketmaster 외부 구매 진행 승인.
추가 요청: 관리자 대시보드에서 Ticketmaster 수익만 분리. 후속 지시로 거래 표·출금 기능 제외: 숫자와 Impact 바로가기만 표시.

## 설계
- 기존 AdminShell에 `ticketmaster` 메뉴. 기존 관리자 JWT 검증 + `log_admin_access('analytics')` 감사 기록 재사용.
- 신규 `ticketmaster-revenue` Edge Function은 읽기 전용 Impact Actions API를 호출한다. AccountSID/AuthToken/허용 Campaign ID는 서버 secret만 사용한다.
- 최근 세 달 중 구매 발생 월 선택. **선택 월에 발생한 수수료의 현재 상태**: PENDING 확정 대기, APPROVED + ClearedDate 없음 승인 후 정산 대기, APPROVED + 과거 ClearedDate 정산 완료. REVERSED 제외. 월별 실제 은행 입금액이 아니다.
- 통화별 소수 금액 문자열을 정수(소수 6자리)로 정확히 합산. `Amount`(티켓 판매액)는 절대 수익으로 사용하지 않는다.
- API 마지막 수정일 기본 7일 필터 누락을 방지하도록 구매월 시작→현재를 45일 이하로 분할 조회, ID 중복 제거. 페이지 전체 조회 실패/상한 초과/비정상 응답 시 전체 오류 처리한다.
- 실제 서버 응답이 없을 때는 `—`와 미연결/오류 표시. 실제 빈 응답은 기록 없음. 로컬 미리보기는 가짜 매출을 운영 수치로 표시하지 않는다.
- 클라이언트에는 월별 합계만 전달한다. 구매자·주문·개별 액션 데이터는 전송/저장하지 않는다.
- 인메모리 5분 캐시(인스턴스 내)로 중복 새로고침을 줄인다. 영구 테이블·예약 작업은 만들지 않는다.

## 프로젝트 / 스타일 / 검증
Expo 57, React Native Web 기존 theme/StateCard/InteractionFeedback 사용. 새 패키지 없음.
서버 순수 함수 `supabase/functions/_shared/impact-revenue.ts`, handler `supabase/functions/ticketmaster-revenue/index.ts`, 화면 `src/components/admin/admin-ticketmaster.tsx`.
`const { play } = useInteractionFeedback();`를 필터·새로고침·외부 링크에 적용.
검증: `node --experimental-strip-types --test scripts/impact-revenue.test.mjs`, `npx tsc --noEmit`, `npm test`, admin web export/Orca 렌더.
외부 secret 입력 전까지 실제 계정 숫자와 제휴 승인 상태는 미검증. 외부 계약 승인·출금·유료 작업은 수행하지 않는다.

## 구현 순서
- [x] 집계/페이지네이션/기간 경계 테스트를 먼저 작성하고 순수 서버 함수 구현
- [x] 기존 관리자 권한과 감사 RPC를 사용한 Edge handler 연결
- [x] 기존 메뉴에 숫자 전용 화면 적용 (후속 사용자 지시: 별도 시안/샘플 진입 없이 실제 54321 관리자에 적용)
- [x] 타입/전체 테스트/개발 화면 렌더 검증, 실제 연결 상태 기록
- [x] Impact 로그인 복구, 조회 전용 API 키 서버 등록, 실제 Campaigns API HTTP 200 확인
- [ ] Ticketmaster 제휴 승인 후 활성 프로그램 ID 연결 및 실제 수익 응답 검증 (현재 In Review / 활성 프로그램 0개)

## 근거
- https://integrations.impact.com/partner-api-reference/reference/actions/models.md (Payout, State, ClearedDate)
- https://integrations.impact.com/partner-api-reference/reference/actions/actions.md (EventDate 및 LastUpdated 기간)
- https://integrations.impact.com/partner-api-reference/readme/pagination.md
- https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/finance/payments-withdrawals-and-balance/partner-payments-explained-from-action-to-payout
- BrandKit gling tokens: src/constants/theme.ts와 동일.
- Mobbin Upwork 잔고 단계 구분 https://mobbin.com/screens/87c3379b-2f64-40fd-b0d6-bbf30afd8985
- Mobbin Stripe 통화·상태 구분 https://mobbin.com/screens/80054ec0-bb9d-4438-9a66-4f7bcd8f103f
- Kroma는 API key 미설정. Pinterest 결과는 금융 집계 기준 근거로 사용하지 않음.
