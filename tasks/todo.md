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
