# 업체 계정 YES/NO · 웹 글/사진 관리 · 네이버 카페

2026-10-08 사용자 후속 요청. 기존 일반 회원 계정에 관리자만 변경하는 업체 관리 권한을 더한다. 관리자 역할·개인 멤버십과 별개다. 기존 업체 소유자는 접근을 보존하며 신규 회원은 기본 NO. YES여도 연결된 본인 업체만 접근하고 기존 업체 소유 확인·최신 원고 승인·안전 검토를 유지한다. NO 전환은 관리 접근과 AI/외부 게시를 차단하며 글·사진·재고·원고는 삭제하지 않는다.

기존 owner_id·assert_merchant_workspace·정상 게시/사진 수정·AuthProvider·사용 피드백을 재사용한다. 업체 웹은 별도 빌드 경로로 기존 공개 읽기 웹과 관리자 웹의 경계를 유지한다. 계정 로그인, 권한/업체 선택, 글·사진 수정/순서·삭제 확인, 채널 원고를 제공한다. 신규 dependency 없음. `src/merchant-web`, 기존 `src/components/merchant-workspace.tsx`, `src/lib/merchant-workspace.ts`, 관리자 회원 상세, 순차 migration과 `scripts/`의 기존 테스트 패턴을 사용한다.

네이버는 공식 OAuth2와 cafe articles multipart API를 사용한다. 계정 승인·카페 가입/게시판 쓰기 권한과 실제 대상 게시판·최종 제목/본문/사진을 확인한다. 앱 비밀키·토큰은 서버 전용이며 OAuth state 단회/만료·업체별 소유/권한·저장 revision을 검증한다. 입력 URL은 정확한 네이버 카페 호스트의 게시판 주소만 사용한다. 가입 자동 실행, CAPTCHA 우회, 비밀번호 수집, 승인 없는 자동 다건 발행은 추가하지 않는다. 불확실 발행은 동일 요청을 자동 재전송하지 않으며 실제 반환 article URL만 완료로 기록한다. 개발자 앱/키가 없으면 미설정 상태를 정확하게 표시한다.

UI: 기존 night/iris; 관리자는 기존 light. 44px, 접근성 라벨, 모든 변경 컨트롤의 play 피드백, 입력 보존·성공/실패/권한 종료를 표시한다. Apple Design 및 Mobbin Buffer 연결 설정(https://mobbin.com/screens/84d67379-0c62-495c-8ce8-d3583db11553)에서 계정/채널별 연결 상태를 참고했다. 연결됨과 실제 게시 완료를 구분한다.

계약 예: `client.rpc('set_admin_merchant_access', { p_user_id: userId, p_enabled: true })`. 매 요청마다 서버의 현재 권한을 확인해 오래된 JWT/화면 토글로 우회할 수 없게 한다. 관리자 역할과 업체 권한을 서로 덮어쓰지 않는다.

작업 순서: 1) 권한 API·서버 차단·관리자/앱 UI, 2) 기존 업체 관리와 게시글/사진을 웹에 연결, 3) 네이버 서버 계약·연결/검토/게시와 실패 복구, 4) 통합 타입/테스트/export·동작 HTML 시안·시뮬레이터 재실행. 현재 dirty 작업과 기존 자동화·DM/스토어 제출·다른 업무는 보존한다. 새 외부 발행과 실제 고객 계정 권한 변경은 테스트로 실행하지 않는다.

검증 명령: `npm test`, `npx tsc --noEmit`, 변경 파일 `npx eslint`, `GLING_MERCHANT_WEB=1 npx expo export --platform web --output-dir /tmp/gling-merchant-web`, `npm run export:web`, 기존 DB pgTAP 및 모의 OAuth/서버 응답 테스트. 무권한/다른 업체/NO 전환/잘못된 OAuth state/수정된 원고/중복 발행/네트워크 불확실/사진 순서의 실제 분기를 검증한다. 실제 네이버 승인을 위한 개발자 애플리케이션 존재와 대상 카페는 사용자 답변 대기; 독립 준비는 계속 진행한다.

공식 출처: https://developers.naver.com/docs/login/cafe-api/cafe-api.md , https://developers.naver.com/docs/login/api/api.md , https://docs.expo.dev/versions/v57.0.0/ .

## 확인한 운영 반영과 남은 검증

2026-10-08 Vancouver. 운영 프로젝트의 migration 0129/0130, naver-cafe v1 ACTIVE, 기존 8개 로그인 복귀 주소 보존 및 업체 callback 추가를 재조회했다. 실제 고객 권한 변경·소유자 배정·카페 발행은 0건이다. 업체 YES/NO는 관리자 역할과 별개이며, 운영에서 기존 소유자가 없어 backfill 대상도 0건이었다. 브라우저 토큰 조회·미인증·외부 origin 요청 거부를 확인했다. Node 테스트 379 통과/1 조건부 skip, 관련 pgTAP 138 통과, 타입·변경 파일 lint·워크플로 actionlint·통합 export와 공개/업체 경계 검사를 통과했다.

공개 업체 웹 `/merchant/`는 아직 404이며 배포하지 않았다. 기존 Pages 작업의 통합 빌드와 로컬 결과물은 준비됐다. 네이버 서버의 4개 필수 설정값이 없어 미설정 상태다. 실제 로그인·카페 쓰기 권한·한글 payload·WebP 수신 검증은 설정과 실제 연결 계정으로 남겨둔다. 고객용 AI 연결/MCP는 별도 작업이며 기존 관리자 MCP의 권한을 넓히지 않는다.

브라우저에서 실제 Expo 업체 빌드의 로그인 화면·브랜드 자산·48px 로그인 컨트롤과 `/merchant/` 자산 경로를 확인했다. HTML 동작 시안에서는 모의 저장으로 사진 추가·제거·순서와 저장 후 목록 반영, 원래 글링 작성자 보존, 초안 사진 변경 후 승인/게시 차단, 저장된 순서, 네이버 미설정, NO와 로그인 전 상태를 확인했다. 일부 WebKit AX 클릭은 동작하지 않아 동일한 DOM 컨트롤을 호출해 검사했으며 실제 고객 로그인·글 변경의 증거로 기록하지 않는다. 기존 iPhone 17 Pro에서 글링을 재실행하고 오늘 피드 표시를 확인했다. 검증용 브라우저 탭과 임시 서버는 정리했다. 최종 타입 검사에서 생성된 시안의 TypeScript 백업이 앱 소스로 포함된 것을 발견해 `output`을 검사 대상에서 제외했다. 앱·서버 소스 검사는 계속 수행한다.
