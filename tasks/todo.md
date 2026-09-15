# 글링 Supabase 백엔드 작업

## iOS release preparation — 2026-09-06

- [x] Dependency and backend checks
  - Acceptance: SDK compatibility, unit tests, typecheck, lint and existing DB policy tests pass; production provider status is recorded.
  - Verify: `npx expo install --check`, `node --experimental-strip-types --test scripts/*.test.mjs`, `npm run typecheck`, `npm run lint`, `npx supabase test db`.
- [x] Native build and screenshots (depends on dependency checks)
  - Acceptance: an iOS Release build runs without Metro; real simulator screenshots are stored with device details; signing status is recorded separately.
  - Verify: Xcode build/archive output and simulator launch.
- [x] Store submission materials (depends on build evidence)
  - Acceptance: Korean metadata, privacy/age-rating drafts, review steps, rollback and remaining external requirements are documented without treating unverified operations as complete.
  - Verify: metadata lengths, live policy URLs, artifact paths and `git push origin mobile-app`.

## Android registration — 2026-09-06

- [x] Verify the existing Play Console account and create/reuse Gling's app record.
- [x] Generate Android, verify a signed API 36 AAB and document the protected upload key location.
- [x] Save Korean listing material and an uploaded build, record remaining publication requirements, then push to `origin/mobile-app`.
  - Evidence: `tasks/google-play-release-2026-09-06.md`; this registration commit is delivered through `origin/mobile-app`.

## Existing backend work

- [x] 데이터베이스 기반
  - Acceptance: 일상 글·프로필·댓글·반응·대화·신고 스키마와 Storage 정책이 있다.
  - Verify: `npx supabase db reset`
  - Files: `supabase/migrations/0001_init.sql`

- [x] 보안 정책 검증
  - Acceptance: 익명/타인 접근은 거부되고 소유자·방 멤버·관리자 접근만 허용된다.
  - Verify: `npx supabase test db`
  - Files: `supabase/tests/backend_rls.test.sql`

- [x] Expo 연결 준비
  - Acceptance: 공개 키만 사용하는 클라이언트 설정과 환경 변수 예시가 타입 검사된다.
  - Verify: `npm run typecheck && npm run lint`
  - Files: `.env.example`, `src/lib/supabase.ts`, `package.json`

- [x] mock 초기 데이터 이관
  - Acceptance: 6도시·9태그·17시드 프로필·15글·22댓글과 7개 방 미리보기가 DB에 있다.
  - Verify: `npx supabase db reset && npx supabase test db`
  - Files: `supabase/migrations/0002_seed_mock_data.sql`, `supabase/tests/mock_seed.test.sql`

- [x] 실제 관리자 계정 지정
  - Acceptance: 초대된 실제 사용자만 `app_metadata.role = 'admin'`이고 관리자 프로필이 있다.
  - Verify: 운영 DB에서 이메일·role을 읽기 전용 조회한다.
  - Files: 운영 Supabase Auth 상태(저장소 파일 없음)

- [x] 일일 글쓰기 잔여량 숫자 표시
  - Acceptance: 기본 플랜은 `1/1 → 0/1`, 한도 3은 `3/3 → 2/3`처럼 표시된다.
  - Verify: `npm run test:quota && npm run typecheck`
  - Files: `src/i18n/ko.ts`, `scripts/daily-quota.test.mjs`, `package.json`

- [x] 9개 대분류와 해시태그 적용
  - Acceptance: 9개 대분류가 필터와 글쓰기에 공통 표시되고 기존 글이 보존되며 인기 해시태그가 피드와 글쓰기에 빈도순 노출된다.
  - Verify: `npm run test:categories && npm run typecheck && npx supabase db reset && npx supabase test db`
  - Files: `src/lib/mock.ts`, `src/lib/types.ts`, `src/lib/hashtags.ts`, `src/i18n/ko.ts`, `src/app/index.tsx`, DB migration과 테스트

- [x] 트렌드 해시태그 정규화
  - Acceptance: 도시·대분류별 인기 태그가 먼저 보이고 한/영문·오타 별칭은 하나로 집계되며 글당 최대 5개만 저장된다.
  - Verify: `npm run test:categories && npm run typecheck && npm run lint`
  - Files: `src/lib/hashtags.ts`, `src/app/index.tsx`, `src/i18n/ko.ts`, `scripts/categories.test.mjs`

- [ ] 사진 기반 AI 글·모임 초안 (`OPENAI_API_KEY` 설정·Edge Function 배포만 남음)
  - Acceptance: 사진 한 장으로 9개 대분류·제목·본문·최대 5개 태그 초안이 생성되고 사용자가 수정 후 게시한다.
  - Verify: `npm run test:ai-draft && npm run typecheck && npm run lint`
  - Files: `src/lib/ai-draft.ts`, `src/app/index.tsx`, `supabase/functions/draft-post/`, AI 사용량 migration

- [x] 공유 유입과 익명 프로필 온보딩
  - Acceptance: 공유 글은 게스트가 읽고 상호작용 시 카카오 로그인과 프로필 생성으로 이어지며 한·영 랜덤 닉네임을 제공한다.
  - Verify: `npm run test:sharing && npm run test:onboarding && npm run typecheck && npm run lint`
  - Files: 공유 글 route, `src/lib/sharing.ts`, `src/lib/nickname.ts`, 인증·온보딩 UI

- [x] Auth 딥링크 이름 통일
  - Acceptance: 앱 scheme·slug·패키지 이름과 로컬 Supabase Redirect URL이 `gling` 기준으로 일치한다.
  - Verify: `npx expo config --type public`과 `supabase/config.toml` 확인
  - Files: `app.json`, `package.json`, `supabase/config.toml`

- [x] 신규 사용자 프로필 연결
  - Acceptance: 프로필이 없는 로그인 사용자는 닉네임·지역을 저장한 후 앱을 사용한다.
  - Verify: 신규 사용자로 프로필 생성 후 자신의 행만 수정 가능한지 확인
  - Files: 프로필 화면과 인증 컨텍스트 관련 파일

- [x] 카카오 소셜 로그인과 iOS Apple 로그인 앱 연결
  - Acceptance: Android에는 카카오, iOS에는 카카오와 Apple 로그인을 표시한다. 카카오 PKCE 콜백을 검증하고 기존 Supabase 세션 체계를 사용한다. Google은 현재 사용자 요구에서 제외한다. 실제 운영 로그인 성공은 아래 별도 검증 항목을 따른다.
  - Verify: `npm run test:auth && npm run typecheck` 및 Expo 웹 렌더링 확인
  - Files: `src/lib/auth.tsx`, `src/lib/kakao-auth.ts`, `src/components/login-panel.tsx`, `src/i18n/ko.ts`, `app.json`

- [ ] 카카오·Apple 운영 설정과 실제 계정 검증
  - Acceptance: Release 빌드에서 실제 계정 로그인·프로필 생성·세션 복원·로그아웃·탈퇴와 외부 공급자 연결 해제를 확인한다. 카카오는 활성, Apple은 비활성 상태이며 카카오 연결 해제 구현이 남았다.
  - Verify: [2026-09-07 인증 검증 기록](auth-verification-2026-09-07.md). 자동 검사 200개 통과와 실제 계정 인증은 구분한다.
  - Files: Kakao Developers, Apple Developer와 Supabase Auth 운영 설정

- [x] 관리자 웹 MVP
  - Acceptance: `/admin`에서 관리자만 전체 신고·사용자·게시글·대화를 조회하고 사용자 활동을 확인하며 신고를 처리한다. 관리자 열람은 감사 로그에 남는다.
  - Verify: `npm run test:admin && npm run typecheck && npm run lint && npx expo export --platform web && npx supabase db reset && npx supabase test db`
  - Files: `src/app/admin.tsx`, `src/components/admin/`, `src/lib/admin.ts`, 관리자 migration과 pgTAP 테스트

- [ ] 전체 사용자 흐름 DB 통합
  - Acceptance: 개발용 실제 세션에서 글·반응·댓글·신고·대화·공유·프로필이 DB와 관리자 화면까지 이어진다.
  - Verify: `node --experimental-strip-types --test scripts/*.test.mjs && npx supabase db reset && npx supabase test db && npm run typecheck && npm run lint && npx expo export --platform web`
  - Files: `tasks/user-flow-integration-spec.md`, 관련 앱·Supabase 파일

- [ ] 커뮤니티 안전·알림·성능 보강
  - Acceptance: 공유 중복, 입력·호출 제한, 모임 승인, 알림, 관리자 조치, 탈퇴 잠금과 페이지네이션이 서버 규칙으로 연결된다.
  - Verify: `node --experimental-strip-types --test scripts/*.test.mjs && npx supabase db reset && npx supabase test db && npm run typecheck && npm run lint && npx expo export --platform web`
  - Files: `tasks/community-hardening-spec.md`, 신규 migration·pgTAP, 관련 앱 데이터/UI 파일
# B안 동네 저널 리디자인

- [x] 첫 사진 1개·모임 2개 배치의 중복/페이지 순서 회귀 검사와 구현
  - Verify: `node --experimental-strip-types --test scripts/feed-data.test.mjs`
- [x] B 피드·사진/텍스트 카드·도시 시트·작성 횟수 안내 반영
  - Acceptance: 승인된 시안의 위계와 기존 데이터·권한·9개 카테고리·4개 탭 보존
  - Verify: `npm test`, `npm run typecheck`, `npm run lint`
- [x] iOS 시뮬레이터와 Android 번들 검증 후 화면 증거와 변경 기록 저장
  - Acceptance: 사진 없음/있음·도시·검색·큰 글자·다크 모드 확인, 출시와 구분
  - Evidence: `journal-redesign-spec.md`의 검증 결과와 `output/design/gling-redesign/implemented/` 화면

## 구독 도입 준비 — 2026-09-09 (프로젝트 생성 완료, 결제 구현 미착수)

- [x] 기존 코드·Apple 상품과 Google 판매 준비 상태 확인.
  - Evidence: 결제 SDK 없음, 글 작성 한도 RPC 재사용 가능. ASC 구독 그룹·인앱 상품 각 0개 확인. 글링 Play 수익 창출 화면에서 판매자 계정 설정 필요 안내 확인. Apple 유료 계약 상태와 RevenueCat 연결 자격은 미확인. `plan.md`의 연결 준비 상태 기록을 따른다.
- [x] 사용자 지시에 따라 RevenueCat 소개 폼 제출·글링 전용 프로젝트 생성.
  - Evidence: 사용자가 가입한 계정에서 `Gling / Social Networking / 신규 인앱 구매 앱 / Founder · Executive / React Native`를 제출하고 프로젝트 `db748917`의 대시보드를 확인했다. 기존 `Git → gling` 브라우저 탭을 사용했다.
- [x] RevenueCat 가입 이메일 인증.
  - Evidence: `gling@ej-entertainment.com` 포워딩 설정 후 인증 메일을 재발송했다. 사용자의 인증 완료 통보 후 대시보드를 새로 열어 미인증 경고가 사라진 것을 확인했다.
- [ ] RevenueCat 스토어 연결 준비.
  - Acceptance / Verify: 연결 비밀 정보는 기존 Git 외부 자격 증명 디렉터리에 보관하고, iOS/Android 스토어 연결 검증 여부를 별도로 기록한다.
  - Status: App Store 연결 폼에 이름과 Bundle ID를 준비했으며 인앱 구매 전용 키가 없어 저장하지 않았다. 기존 글링 App Store Connect 로그인 화면을 실제 표시했다. Google 결제 프로필도 아직 없다. 스토어 키 연결·SDK 설치·실결제는 미완료다.
- [ ] 1. 활동 한도별 멤버십 등급과 월 가격 결정 (의존: 없음, 범위 S)
  - Acceptance / Verify: 사용자가 지정한 하루 글 1·2·5편과 모임·1:1 대화의 3·5·10을 유지하고 모임·대화의 기간/집계 단위를 확정한다. 프리미엄 선택 가치를 크게 만드는 가격 구성을 검증한다. 글은 계정 전체에서 합산하고 모든 등급에 동일한 도배 제한을 둔다. 실제 사용자 피드백, 스토어 수수료·혜택 운영비를 포함한 가격을 기록한다. 기존 대화·모임의 하향 변경 후 처리도 확정한다.
  - Files: `tasks/plan.md`; 현재 상품명·혜택은 제안이며 확정되지 않았다.
- [ ] 2. 정산 상태와 테스트 상품 준비 (의존: 1, 범위 S)
  - Acceptance / Verify: 양 스토어의 유료 판매 계약·세금·은행/결제 프로필 상태와 Apple Small Business Program 가입 여부를 확인한다. 가격·기간을 확정한 후 월·연 상품을 테스트 계정에서 조회하고, 실제 수수료와 RevenueCat 요금/SDK 호환성을 다시 확인한다. 주 구독은 현재 제안 범위에 포함하지 않는다.
  - Files: 스토어·RevenueCat 설정과 작업 기록. Gling 브라우저 폴더를 사용한다.
- [ ] 3. iOS 월 결제에서 첫 혜택까지 연결 (의존: 2, 범위 M)
  - Acceptance: 실제 구매를 검증한 글링 계정에만 혜택이 열리고 취소·보류 구매에는 열리지 않는다.
  - Verify: StoreKit/TestFlight 테스트 결제·취소, 서버 권한 검증 및 `npm run typecheck`.
  - Files: 구매 클라이언트, 의존성 파일, 구독 상태 migration, 서버 연동 함수, 선택한 혜택의 기존 코드. 혜택이 여러 화면이면 별도 작업으로 나눈다.
- [ ] 4. Android 월 결제와 공통 계정 연결 (의존: 3, 범위 S)
  - Acceptance: Play 테스트 결제로 같은 혜택을 사용하고 같은 글링 계정으로 기기를 바꿔도 상태가 이어진다. 다른 글링 계정에 구매를 재사용하지 못한다.
  - Verify: Play 내부 테스트 결제·취소와 iOS/Android 계정 전환, 기존 구독의 중복 가입 방지 확인.
  - Files: 구매 클라이언트, Android 설정, 테스트 기록.
- [ ] 4a. 모임 가입·승인의 멤버십 한도 연결 (의존: 3, 범위 M)
  - Acceptance / Verify: 기존 모임 상태 모델을 확인하고 원자적인 승인 한도 검사를 적용한다. 대기·승인·종료·탈퇴 및 동시에 들어오는 승인으로 초과되지 않는 작은 DB 검사를 남긴다. 진행 중 모임 판정에 필요한 종료 상태가 없으면 그 상태 전이를 먼저 별도 작업으로 구현한다.
  - Files: 모임 RPC migration, 기존 모임 데이터/UI, DB 검사.
- [ ] 4b. 새 1:1 대화의 멤버십 한도 연결 (의존: 3, 범위 M)
  - Acceptance / Verify: 새 상대 요청만 차감하고 기존 대화·수락·모임 대화는 유지한다. 재요청·날짜/도시 변경·동시 요청 우회와 일반 회원에게 온 요청 수락을 DB 검사로 확인한다. 실제 그룹 채팅 기능은 별도 선행 작업이며 결제만으로 생기지 않는다.
  - Files: 대화 RPC migration, 기존 대화 데이터/UI, DB 검사.
- [ ] 5. 구독 생명주기와 복원 검증 (의존: 4·4a·4b, 범위 M)
  - Acceptance: 4a·4b 완료 후 월·연 결제와 기간 변경, 갱신·등급 상향/하향·자동 갱신 해지·만료·유예·환불·복원 시 검증된 상태와 한도가 일치한다. 같은 등급은 월·연 구독의 활동 한도가 같고 기존 데이터·대화·참여를 보존한다. 위조/중복/역순 웹훅이나 앱 재설치로 권한이 잘못 열리지 않는다.
  - Verify: 상태 전이/웹훅의 작은 회귀 검사와 두 스토어의 테스트 도구. 구독 관리와 계정 삭제 시 안내도 확인한다.
  - Files: 구독 함수, 상태 migration, 회귀 검사, 구독 관리 화면, 기존 계정 삭제 화면.
- [ ] 6. 구독 포함 새 버전 심사 준비 (의존: 5, 범위 S)
  - Acceptance / Verify: 실제 혜택·현지 가격·기간·자동 갱신·복원/관리·약관을 확인하고, Apple 첫 구독과 새 앱 버전 및 Android 새 번들을 준비한다. 테스트와 실제 공개 출시 상태를 구분해 기록한다.
  - Files: 스토어 메타데이터, 약관, 출시 기록.

체크포인트: 2 이후 상품 범위 확인, 4 이후 양 플랫폼 실제 결제 흐름 확인, 5 이후 권한·복원 검증 통과 후 출시 준비. 지금은 계획만 기록했다.

## 공개 게시판·모임·추가 수익모델 검토 — 2026-09-09

- [x] 당근·모임 앱 공식 자료와 실제 Mobbin 참고 화면을 비교하고 방향 검토안을 작성했다.
  - Evidence: `community-direction-2026-09-09.md`. 서비스 수요나 수익을 검증한 결과는 아니다.
- [x] 사용자 설명에 맞춰 글 홍보를 추가 노출 횟수 소진형으로 정정했다.
  - Evidence: 무료 회원 구매 가능, 자연 노출 제외, 구매 횟수 도달 시 자동 종료. 900원/900회·1,700원/1,700회는 예시이며 기존 기간제 제안을 대체했다. 문서 반영이며 앱 구현은 아니다.
- [ ] 무료 공개 게시판의 반복 이용과 모임 전환 수요 확인.
  - Acceptance / Verify: 시드·심사 계정을 제외한 첫 답글, 주간 재방문, 실제 모임 제안·참여 기록으로 다음 구현 범위를 정한다. 그룹 채팅은 별도 선행 구현이 필요하다.
- [ ] 선택형 게시글 홍보의 상품 범위·수요 검토.
  - Acceptance / Verify: 도시·카테고리별 광고 표시·자리 수, 실제 화면 노출 기준·반복 노출 인정 단위, 중단/미소진 수량/환불 규칙·광고 제거 범위를 확정한다. 자연 노출 제외와 중복 이벤트 제거, 잔여 1회 동시 보고 시 수량 초과 방지·자동 종료·새 배정 중단을 구현 검증 기준에 포함한다. 실제 공급 가능한 노출량·소진 속도·구매 의도로 가격을 검증한 후 인앱 결제를 설계한다. 이 단계에서 상품 등록이나 판매를 시작하지 않는다.


## 2026-09-09 마케팅 강의 전체 검토와 운영 개선

- [x] 17개 챕터 전체 자막과 실습 화면 검토, 구간별 근거 기록
- [x] 기존 스킬·글링 운영·자동화의 실제 흐름과 누락 비교
- [x] 실행 절차·측정·오류 처리 개선 반영
- [x] 외부 발행 없는 한 회차 시험 실행과 재실행 검증
- [x] 전체 분석·변경 결과 보고와 공통 지식 갱신

검증: 전체 17챕터/2,839자막 구간과 선택 화면 23개, 기존 CSV 12개 정상 점검, 재실행 후 파일 불변, 잘못된 ID/도착/태그/변수/증거/0의 합성 테스트. 실제 글링 웹의 UTM·도시·메일 CTA 확인. HTML 링크·목차·실제 Orca 표시 확인. 상세: `marketing/reports/2026-09-09/course-process-review.html`. SNS 계정·실제 정기 발행·전환 수집은 별도 남은 조건으로 기록했으며 이번 검증은 외부 발행 없는 준비 회차다.

## 2026-09-10 홍보 크레딧 — 출시 제외

- [x] 승인한 재화/슬롯 안내 규칙과 실제 구현 차이 기록
- [x] 구매별 지급·배정·중단·환불 DB 및 검증 webhook 연결 코드
- [x] 개발용 지갑과 내 글 홍보 화면, 사용자 진입점 숨김 및 직접 경로 차단
- [x] 단위 테스트 62개·로컬 DB 검사 260개 통과
- [ ] 재개 시: 실제 관계 슬롯 API 연결, 스토어 상품/가격 확정, sandbox 실제 구매, 노출 가시성/무효 트래픽 측정 및 피드 연결
- [ ] 재개 시: 잔액을 보유한 계정 삭제·거래 보존 정책, 실제 환불·복원/기기 변경·부분 환불 검증

운영 서버와 심사 제출본에는 이번 개발 기능을 배포하지 않았다.

## 2026-09-10 관계 슬롯 — 새 빌드 필수

- [x] 3/5/10 동시 슬롯, 1:1 수락 및 최초 요청자 24시간 규칙, 모임 공용 대화와 탈퇴 잠금 구현
- [x] 기존 메시지 안전 분석·전체 관리자 열람/감사·차단·삭제 경로 반영
- [x] 출시용 로컬 DB 302개 검사와 두 실제 DB 연결의 마지막 자리 동시 수락 검증 (크레딧 29개는 별도 미배포 검사)
- [x] UI 최종 검증, 새 iOS/Android Release 빌드 8
- [x] 운영 0033 마이그레이션, TestFlight/Google 내부 테스트 빌드 8 배포 및 iOS 심사 교체
  - Evidence: `tasks/relationship-release-2026-09-10.md`. iOS 심사 대기, Google 공개 출시·구독 판매 조건은 별도 남음.

사용자는 기존 빌드 유지가 아니라 관계 슬롯을 포함한 새 빌드를 원한다고 정정했다. 크레딧/홍보의 판매·송출·사용자 노출은 계속 보류한다.

## 2026-09-11 관리자 회원 식별·활동 보강

- [x] 관리자 전용 식별/검색/활동 RPC와 보안·페이지 회귀 검사
- [x] 회원 검색·식별 정보·시간순 활동·대화 맥락 UI
- [x] 운영 RPC/로컬 관리자 빌드 적용과 실제 확인

- [x] 추가 요청: 등록 지역·인증 세션 IP/시각·보관 세션 활동 표시 (운영 0036, DB 327개 및 실제 Orca 확인)

## 2026-09-11 Optional one-shot location
- [x] Trace login, onboarding, writer and admin paths; inspect design references.
- [x] Write spec and failing Node/DB checks.
- [x] Implement consent, one-shot city recommendation and private event records.
- [x] Verify native permission configuration, retention/access tests and admin Orca UI; prepare native release notes.
- [x] Apply Apple Design to admin layout, member directory/detail and controls.
- [ ] Validate GPS on devices and update store disclosures for the next native binary (not build 11).
- Evidence: `tasks/location-admin-2026-09-12.md`.

## 2026-09-12 — Private member name and birth date

- [x] Private self-reported name/DOB RPCs, computed age, validation and deletion/security checks.
- [x] Optional explicit-consent entry in onboarding/settings and audited admin name/DOB/age display.
- [x] Build, browser verification and deployment record.
- [ ] Kakao additional name/birthday/birthyear permissions, then verified-provider import. D-U-N-S/Biz app registration is already complete.
- [ ] Next native binary: device input/accessibility checks and store privacy declarations.
- Evidence: `tasks/personal-info-2026-09-12.md`.
