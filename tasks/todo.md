# 글링 Supabase 백엔드 작업

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

- [x] 카카오 단일 로그인 앱 연결
  - Acceptance: 앱에는 카카오 로그인만 보이고 PKCE 콜백을 검증해 Supabase 세션을 만들고 복원·종료한다.
  - Verify: `npm run test:auth && npm run typecheck` 및 Expo 웹 렌더링 확인
  - Files: `src/lib/auth.tsx`, `src/lib/kakao-auth.ts`, `src/components/login-panel.tsx`, `src/i18n/ko.ts`, `app.json`

- [ ] 카카오 공급자 활성화와 실제 기기 검증
  - Acceptance: Supabase Redirect allow list에 `gling://auth/callback`을 등록하고 Kakao만 활성화한 뒤 개발 빌드에서 로그인·로그아웃이 동작하며 첫 카카오 계정에 관리자 역할을 이전한다.
  - Verify: iOS·Android 개발 빌드와 Supabase Auth 사용자·JWT 역할 확인
  - Files: Kakao Developers와 Supabase Auth 운영 설정

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
