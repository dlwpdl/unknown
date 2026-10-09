# 글링 사업자용 MCP

2026-10-09 사용자 승인: 사업자는 평소 쓰는 Codex·Claude Code·ChatGPT·Claude에서 자기 업체의 글·사진·프로필을 관리한다. 일반 이용자 기능은 모바일에 유지한다. OAuth 로그인 후에도 서버가 현재 계정에 할당된 업체·기능만 매번 허용한다. 기존 관리자 MCP는 별도다.

## 계약과 범위

- 기존 Supabase OAuth 2.1/PKCE·토큰 회전과 글링 로그인 재사용. `offline_access`만 요청하며 `openid/profile/email/phone`은 거절한다. 신규 인증 서비스·패키지·예약 없음.
- 사업자가 연결할 본인 업체와 초안 저장/제안·승인된 원고 게시 권한을 고른다. 읽기는 기본, 게시 권한은 기본 꺼짐. 연결은30일, access token은 기존1시간. 해제/만료/사업자 NO/소유 변경/비활성 계정은 즉시 거절.
- 연결 저장은 화면에서 검토한 `p_expected_actor_id`와 서버의 `auth.uid()`가 일치할 때만 허용한다. OAuth 조회·승인 후에도 현재 계정과 요청 소유자를 다시 확인하여 다른 탭의 계정 변경으로 엉뚱한 연결이나 코드를 승인하지 않는다.
- OAuth 토큰은 `sub=mcp:<연결 UUID>`, 실제 작업자는 별도 서명된 `gling_actor_id`, audience는 MCP 주소, role은 DB에 존재하지 않는 `gling_mcp`다. 일반 로그인·심사·관리자 hook은 내용 변경 없이 private로 이동해 호출한다. audience/role만 바꾸면 native Auth 계정 API가 허용하는 문제가 있어, UUID가 아닌 subject로 차단한다. `openid`를 막아 기존 사용자 UUID를 담는 별도 ID token도 발급하지 않는다. 이메일·전화·사용자 메타데이터는 비운다.
- Edge는 기존 SDK로 ES256 서명을 확인한 뒤 issuer·audience·role·expiry·actor·연결·client·native session·scope를 검증한다. 최초 발급 때 native session을 정확히 한 연결에 묶고 갱신 때도 재검사해, 이전 refresh token이 재연결 권한을 얻지 못한다. 매 호출의 server-only dispatch는 현재 활성 계정·사업자 권한·소유·선택한 비즈니스·native 동의·연결·도구를 다시 확인하고 기존 비즈니스 RPC를 사용한다. 브라우저·AI에는 service key를 전달하지 않는다.
- 도구: list_my_businesses, get_business_profile, list_business_posts, get_business_post, list_business_drafts, save_business_draft, preview_business_draft, publish_business_draft, propose_business_change, get_business_change.
- 글링 초안만 취급한다. 초안 변경은 승인 해제·기존 revision 확인. AI는 승인하지 못하고 웹에서 검토·승인된 정확한 원고만 게시한다. 재시도는 같은 draft UUID로 중복 게시하지 않는다.
- 공개 프로필/게시글 수정·삭제는 불변 제안으로 저장한다. 사업자가 웹에서 현재·제안 사진과 정확한 본문을 검토한 뒤 한 번 더 확인해 적용한다. 사진 서명/실제 로딩 실패 시 적용은 막고 거절은 허용한다. 적용 시 원문을 잠그고 revision을 다시 검사해 편집 경쟁을 방지한다. 조회수·좋아요 카운터는 본문 revision에 영향을 주지 않는다. 다른 비즈니스·원본 변경·연결 해제에는 적용하지 않는다. 실제 저장된 사진 경로만 사용하며 외부 URL 다운로드는 없다.
- 비즈니스 권한 NO나 만료된 연결 요청에도 본인 연결 목록·해제는 사용할 수 있다. 활성 연결을 과거 해제 기록보다 먼저 표시하고, 대기 제안은 검토된 기록보다 먼저 표시하며 만료/해제된 대기는 제외한다. 연결 여부는 native 세션·동의가 확인될 때만 표시한다.
- 원가·재고·결제·회원 목록·개인 채팅·SQL·조회수 조작·카페 자동 발행 도구는 제공하지 않는다. 기존 안전 검토·게시 한도·원 작성자는 보존한다. audit에는 도구/대상/시각만 기록하며 인증 자료와 대화는 저장하지 않는다.

## 구현 순서

1. 연결·OAuth token hook·server dispatch·권한 경계: 적용된 migration0142 원본을 보존하고 검토한 계정 확인은 후속0148로 적용한다. 공유 DB reset 없이 검사 트랜잭션은 롤백한다. 기존 private 업체 helper를 실행할 수 있는 동일한 신뢰된 migration owner로 실행하며 API 역할에 helper 권한을 추가하지 않는다.
2. 고정 도구·Streamable HTTP·protected resource discovery·실패/입력/토큰 검사: 기존 npm Supabase SDK와 WebCrypto 사용, Node 실행 테스트.
3. 별도 merchant-web AI 연결/consent 경로·연결 해제·제안 검토: 기존 AuthProvider/night/44px/interaction feedback 사용. 기존 Pages writer에게 통합 경로 전달.
4. 타입·lint·전체 테스트·별도 업체 export·실제 OAuth 및 MCP client 연동 확인. 외부 실제 고객 글 발행과 계정 권한 변경은 검증용으로 하지 않는다.

## 파일과 실행 검사

소스: `supabase/functions/merchant-mcp/`, `supabase/functions/_shared/merchant-mcp.ts`, `src/lib/merchant-mcp.ts`, `src/merchant-web/ai.tsx`, 독립 연결 컴포넌트. 명세/테스트는 기존 `docs/specs/`, `scripts/`, `supabase/tests/` 형식.

`node --experimental-strip-types --test scripts/merchant-mcp*.test.mjs`, `npx tsc --noEmit`, 변경 파일 `npx eslint`, `npm test`, `GLING_MERCHANT_WEB=1 GLING_PUBLIC_WEB=0 GLING_WEB_BASE_URL=/merchant npx expo export --platform web --output-dir /tmp/gling-merchant-mcp-web`. DB는 기존 `supabase_db_gling`에서 신규 migration만 적용하고 트랜잭션 pgTAP을 실행한다.

## 운영 확인과 제한

시작 시 기존 Gling project wjvahbdwmctzpkndqaxa, ES256 JWKS, OAuth server disabled를 실제 조회했다. 사용자 후속 승인으로 전용 `merchant-mcp` Edge v1과0148의 검토 계정 확인을 운영에 적용했다. 이미 적용된0142 소스는 운영 원본 SHA2564161855b58d8cbffe6f3a3024583a4fc385bd177beaf8e2801574bbe9584a6e7로 고정하고 다시 실행하지 않았다.0148은 기존4인자 함수를 제거하고5인자 함수의 authenticated-only 실행 권한을 검증했다. 기존 앱/전용 hook과 다른 migration 내용 및 고객 MCP 데이터는 바뀌지 않았다. 중앙이 과거 웹4파일의 exclusive ownership 추정을 정정했고 실제 최신 원본/진행중 충돌을 대조한 뒤 준비된 최소 patch만 본인 단일 writer로 통합했다. 기존 모바일 callback·provider·프로젝트·업체 기능과 popup 로그인은 보존했다. 운영 OAuth는 비활성이며 기존 Pages 배포 흐름에 웹 반영을 연결 중이다. 실제 `/merchant/`·로그인 callback은200, `/merchant/ai`는404다.

설치된 Supabase CLI2.114.0 공식 소스의 키는 `auth.oauth_server.authorization_url_path`다. 원격 `toAuthConfigBody`는 OAuth 설정을 아직 구현하지 않아 일반 `config push`를 활성화 증거로 취급하지 않는다. 공식 CLI source f8250034bddc9fff102ea6d4fb61c667850c7230의 생성 API client/types와 실제 native GET은 Management API `GET/PATCH /v1/projects/{ref}/config/auth` 및 `oauth_server_enabled`·`oauth_server_allow_dynamic_registration`·`oauth_server_authorization_path`를 지원한다. 기존 CLI의 인증으로 설정을 읽었고 토큰/원본 config/provider secret은 저장하거나 출력하지 않았다. native Auth는 Site URL에 동의 경로를 이어 붙이므로 HTTPS origin 전환과 현재 명시적 mobile/merchant redirect allowlist 유지가 필요하다. 실제 웹 동의 route200 확인 후 이 OAuth3키와 Site URL만 반영하고 나머지 설정의 fingerprint 불변을 재조회한다. 운영 활성화 후 실제 discovery의 `offline_access`, 토큰 subject·session binding 및 각 AI 클라이언트의 scope/PKCE/resource/갱신을 검사해야 한다. 공식 최신 소스 확인은 클라이언트 호환성의 실행 증거가 아니다.

현재 검증: 통합한 실제 소스의 Node MCP15+비즈니스 웹10개, 정확한0142+0148의 rollback-only pgTAP73개, 앞선 전체554통과/1기존 skip/실패0. 실제 공개 HEAD785734a 기준의 별도 배포 worktree에는 이 기능17개 경로만 반영했고 전체451통과/1기존 skip/실패0, 타입·변경 lint·전체 public/merchant web export 및 관리자 코드 분리 검사에 통과했다. 기존 공개 환경변수만 사용하고 패키지 설치·mobile release tag는 만들지 않았다. config의 HTTPS Site URL·OAuth 설정은 목표 상태를 선언하며 운영 반영은 웹 동의 route200 확인 뒤 기존 Management API의4필드 PATCH로만 수행한다. 테스트한 Edge SDK는2.112.4로 고정했다. 배포된 endpoint의 공개 metadata·인증 없음·위조 서명·허용하지 않은 Origin·미디어 타입·본문 크기·preflight7개를 실제 검사했고 다른9개 Edge 함수의 ID/version/hash/verify_jwt는 유지됐다. 최소 통합 patch는 최신 원본에 `git apply --check` 후 적용했고 before/after SHA를 보존했다. 별도 HTML 시안4크기와 상호작용, 통합 Expo의4폭/44px 버튼/AI 이동/한정 callback 복귀/로그인 라벨을 기존55초 GUI guard에서 검사했다. 화면 QA는 운영 인증/네트워크 대신 격리한 가짜 응답으로 수행하며 결과와 기존 Expo Suspense fallback은 `output/qa/merchant-customer-mcp-2026-10-09/`에 분리 기록한다. 실제 로그인·갱신·취소·해제·다른 비즈니스 거절과 일반 앱 API 거절은 운영 OAuth 활성화 뒤의 실행 확인으로 남아 있다.

운영 영수증은 `edge-deployment.json`, `live-http.json`, `0148-deployment.json`, `web-readiness-latest.json`에 있다. 기존 전체 npm audit은37개(critical1/high25/moderate11)를 보고했고 critical은 웹 빌드 도구 shell-quote1.10.0이다. 별도 Edge에 해당 도구는 없으며 사용한 Supabase SDK/Auth/PostgREST 보고는0이다. 전체 build 도구 수정은 공유 package/lock 담당자에게 전달했으며 자동 fix나 Expo downgrade는 하지 않았다.

2026-10-09 추가 이미지 모델 지시 적용 여부: 해당 없음. 이번 작업은 기존 승인 로고·사진을 그대로 사용한 HTML/Expo 화면과 브라우저 QA이며 이미지 생성·편집 제작이나 유료 API 호출이 없다.

공식 근거: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication , https://supabase.com/docs/guides/auth/oauth-server/token-security , https://supabase.com/docs/guides/auth/oauth-server/getting-started , https://modelcontextprotocol.io/specification/2025-11-25/basic/transports .
