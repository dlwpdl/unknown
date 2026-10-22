# 업체 프로필 후속 행동과 채팅 알림

## Objective and accepted scope

2026-10-09 사용자가 승인한 다섯 기능: 실제 업체 담당자 문의, 관심 업체 저장, 리뷰 증빙 인증 결과 알림, 이용 후기 업체 답변, 공개 전화·영업시간·길찾기. 후속 요청은 채팅 알림 본문 미리보기 켬/끔 선택이다. 기존 회사 4탭, 작은 평점 아이콘, 계정 연결·채팅·저장 화면·알림 큐를 재사용한다.

## Behavior and boundaries

- 문의는 공개 가능한 업체의 현재 확인된 활성 소유자에게만 기존 1:1 대화를 요청한다. 원문 작성자가 글링인 경우에도 작성자를 대신 사용하지 않는다. 담당자 미연결이면 실제 등록된 공개 전화/출처 링크를 안내한다. 내부 담당자 메모·개인 연락처를 공개 전화로 복사하지 않는다.
- 업체 저장은 계정별 서버 저장이며 기존 저장 화면에서 글/업체를 선택한다. 취소·중복 요청은 안전하게 처리하고 공개가 철회된 업체는 목록에서 제외한다. 새 채용 알림은 이번 범위에 포함하지 않는다.
- 인증 승인/반려는 작성자에게 한 번씩 기존 알림/푸시 경로로 전달한다. 반려 사유는 본인 후기에서 볼 수 있다. 재직 자료·비인증 재직 후기는 계속 본인과 허가된 관리자만 볼 수 있다. 영수증 없는 이용 후기는 계속 업체와 작성자에게만 보인다.
- 업체 답변은 이용 후기만 허용한다. 기존 검증된 회사 접근 권한과 작성자/업체의 차단·신고·삭제·안전 검사를 적용한다. 수정 시 버전 충돌을 확인한다. 비공개 후기에 붙은 답변도 공개하지 않는다. 답변 알림 본문에는 비공개 후기/증빙 내용을 넣지 않는다.
- 공개 전화와 영업시간은 빈 문자열 기본값, 실제 입력된 값만 표시한다. 영업시간은 업체가 적는 텍스트이며 자동 '영업 중' 추정을 하지 않는다. 길찾기는 기존 고정 Google Maps 주소 빌더를 재사용한다.
- 메시지 미리보기는 기본 끔. 끔은 발신자/본문/첨부 주소 없이 '메시지가 도착했습니다'. 켬은 발신자와 짧은 실제 본문, 사진은 사진 안내만. 실제 발송 시 최신 수신자 설정을 검사하여 꺼진 본문은 Expo에 전달하지 않는다. 앱 푸시와 새 메시지 알림 끄기, 차단, 삭제, 세션 만료, 대화방 진입 경로를 보존한다. 이미 발송된 OS 알림을 소급 변경한다고 약속하지 않는다.
- 이미지 생성/편집: 해당 없음. 기존 플랫폼 아이콘을 사용하며 유료 호출·의존성·작업 예약·실제 고객 시험 발송·스토어 배포는 하지 않는다.

## Interfaces

- `get_merchant_profile(uuid)` / `get_my_merchant_profile(uuid)` JSON: 기존 필드에 `public_phone`, `business_hours`, `can_message`, `saved` 추가; private owner ID/연락 메모는 공개하지 않음.
- `start_merchant_conversation(p_merchant_id uuid) -> uuid`: 현재 확인된 담당자를 서버에서 해결, 기존 대화 시작 함수 재사용.
- `set_saved_merchant(p_merchant_id uuid,p_saved boolean) -> boolean`; `get_saved_merchants(p_offset integer default 0) -> {merchants: profile[],has_more:boolean}`.
- `save_merchant_contact(p_merchant_id uuid,p_public_phone text,p_business_hours text,p_expected_updated_at timestamptz) -> my-profile JSON`.
- 리뷰 JSON의 `reply?: {body:string,created_at:string,updated_at:string}|null`; 본인 후기는 `receipt_review_note` 포함. `reply_to_merchant_review(p_merchant_id uuid,p_review_id uuid,p_body text,p_expected_updated_at timestamptz) -> reply JSON`; 처음 답변의 기대 시각은 null, 수정은 기존 reply.updated_at.
- 알림 카테고리 `merchant_reviews:boolean`, 기본 true. 안전한 목적지 `/company/<uuid>?review=usage|employment`.
- 설정 `message_preview:boolean`, 기본 false; 미리보기 구성은 현재 푸시 claim 경계에서 결정한다.

## Structure, style and validation

`src/lib/` RPC 경계, `src/components/` 기존 업체/후기/설정 화면, `src/app/company/` 프로필, `src/components/public-web/` 공개 웹, `supabase/migrations/0144_message_preview.sql` 및 `0145_merchant_conveniences.sql`, `supabase/tests/` 롤백 SQL, `scripts/` Node 행동 검사. 프로젝트 스타일: `client.rpc('set_saved_merchant', {p_merchant_id: merchantId,p_saved: saved})`; SQL은 완전 수식 이름, `security definer set search_path=''`, 권한 명시 제거·부여, 인덱스, 실제 계정 검사. 새/수정 컨트롤은 44px 이상·접근성 이름·`useInteractionFeedback().play(...)`를 유지한다.

Commands: `npm test`; `npx tsc --noEmit`; `npx eslint <changed files>`; `docker exec -i supabase_db_gling psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/<feature>.test.sql`; 기존 Expo 앱/공개 웹/업체 웹 export 명령.

Tests: 변경 전 실패 확인, SQL의 실제 권한·저장·노출·최신 설정·차단·중복·충돌·데이터 보존, RPC 입력/결과, 렌더된 컨트롤 행동 및 외부 연결 주소, 공개/업체 export. 테스트 데이터는 로컬 트랜잭션에서 롤백한다. 기존 사용자·큐·예약을 바꾸거나 실제 푸시를 시험 발송하지 않는다.

## Work plan

- [x] 채팅 미리보기: 설정/claim/푸시 경계/화면/회귀.
- [x] 업체 SQL: 공개 연락 정보·확인된 문의·저장·리뷰 알림과 답변; 권한/회귀.
- [x] 업체 앱: 문의·저장·전화·시간·길찾기, 저장 화면, 행동 검증.
- [x] 이용 후기 답변과 사유: 업체 inbox/앱/공개 웹, 알림 라우팅.
- [x] 연락 정보 편집: 기존 프로필 편집기, 안전한 충돌/실패/이탈 처리.
- [x] 클릭 가능한 HTML, 실제 Orca 탭 및 동일 시뮬레이터 재열기; 전체 관련 검사와 검증 기록.

Research: Apple Design와 현재 글링 화면을 확인했다. 현재 Mobbin MCP는 제공되지 않으며 Kroma의 Mobbin 검색도 SERPER_API_KEY 미설정으로 실패했다. 새 Mobbin 사례를 확인했다고 주장하지 않는다. 사용자 승인한 기존 디자인을 유지한다.

## Verification and release state — 2026-10-09

`output/qa/merchant-conveniences-2026-10-09/verification.json`에 최종 소스 hash와 근거를 저장했다. Node 전체 검사 571개 중 570개 통과·기존 1개 제외·실패 0, TypeScript 및 변경 파일 ESLint 통과. 실제 로컬 PostgreSQL 롤백 검사 672개와 별도 채널 프로필 회귀 102개 통과; 기존 데이터·큐·예약을 보존했다. 앱/공개 웹/업체 웹/관리자 웹 export와 공개 번들의 비공개 RPC 제외 검사를 통과했다. 최종 iOS 스위치 크기 수정 후 앱 export와 전체 Node 검사를 재확인했다. iOS 기본 스위치 높이와 확장 터치 영역을 사용하고 웹의 44px 크기를 유지한다.

업체 답변 작성 중 더 보기/신고 새로고침이 초안을 지우는 문제를 실패 검사로 확인하고 입력 중에는 해당 동작을 막았다. 이용 후기 답변은 원래 고객 후기와 별도 안전 검사·신고 대상으로 처리하며 실제 답변 작성자를 기록한다. 관리자 원문은 기존 AAL2 및 감사 기록을 거쳐 읽는다. 공개 웹은 읽기 전용 도우미만 가져와 업체 쓰기·관리자 API를 번들에 포함하지 않는다.

운영 프로젝트 `wjvahbdwmctzpkndqaxa`에 보호 백업 후 0144/0145만 원자적으로 적용하고 저장된 migration/hash·RLS·권한·공개 필드·기본 미리보기 끔을 재조회했다. 기존 `push-notifications` v10 및 `safety-monitor` v17이 ACTIVE이며 기존 매분 예약 두 개를 유지했다. 정기 SQL 작업 성공은 실제 휴대폰 전달을 증명하지 않는다. 백업은 Git 밖 `~/Library/Application Support/gling/backups/merchant-conveniences-20261009T204147Z`에 보존한다.

클릭 가능한 예시 `output/design/gling-merchant-conveniences-2026-10-09.html`을 현재 mobile 프로젝트의 Orca 탭 `b9808522-a176-45f6-ae22-3773b3bcfb3d`에 실제 열고 클릭·320/390/768/1440 폭·44px 컨트롤·모션 감소·외부 요청 없음까지 확인했다. 예시의 모든 값과 동작은 로컬 시연이며 실제 고객 데이터나 전송이 아니다. 같은 Journal 시뮬레이터 `51A6BA64-7907-47E7-82AC-6386BA21F8D6`의 `com.dlwpdl.gling`을 최종 변경 후 다시 실행하고 알림 설정의 미리보기 끔 화면을 확인했다. 검증 목적으로 실제 계정 설정을 바꾸거나 메시지를 보내지 않았다.

남은 출시/실측 범위: 앱 스토어와 공개·업체·관리자 웹 호스팅에는 이번 프런트엔드를 배포하지 않았다. 실기기 잠금 화면의 실제 푸시 수신과 실제 업체 계정의 운영 입력은 시험하지 않았다. 새 스키마의 겹치는 세션 동시성 시험은 롤백 DDL이 다른 세션에 보이지 않아 수행하지 않았으며, 권한·잠금·버전 충돌은 단일 세션 SQL 검사로 확인했다. 별도 의존성·예약·서비스·시험 고객 데이터는 추가하지 않았다.
