# 비즈니스 프로필 계정 연결 · 2026-10-09

사용자 승인: 독립된 업체 프로필을 선등록하고 소유자와 운영 담당자를 연결한다. 잘못 연결된 계정의 업체 정보 접근을 막는 것이 우선이다. 후속 정정으로 MFA 관리자에게는 즉시 직접 연결도 허용한다. 초대·수락은 선택이며 실제 고객 계정 연결이나 공개 배포를 검증용으로 실행하지 않는다.

## 범위와 수용 기준

- 기존 merchants·owner_id·등록·게시·모니터링·관리자 MFA를 재사용한다. 소유자 없는 업체는 관리자가 준비하고, 공개 동의와 소유 확인은 유지한다.
- 소유자는 기존 업체 도구를 사용한다. 별도 운영 담당자는 지정 업체의 프로필·원고·글·사진만 관리하며 원가·재고·계약 보고서·비공개 후기·외부 계정 토큰은 읽거나 수정하지 못한다.
- 관리자 화면에서 기존 회원 검색을 재사용해 계정을 선택한다. 업체·주소·회원·역할·확인 기록을 검토하고 직접 연결 또는 7일 이내 초대를 선택한다. 관리자 권한을 고객 계정에 부여하지 않는다.
- 직접 연결은 서버의 현재 MFA·계정 상태·업체 revision·선택한 회원 정보·확인 기록을 검사한다. 기존 소유자를 덮어쓰지 않는다. 이전 연결을 명시적으로 해제해야 변경할 수 있다.
- 초대는 특정 회원 UUID에 묶는다. 수락 전에는 비공개 자료를 공개하지 않는다. 만료·취소·재사용·다른 계정·사업장/소유권 변경을 서버에서 거부한다. 외부 이메일이나 메시지 전송은 추가하지 않는다.
- 소유자/관리자는 운영 담당자의 연결을 해제할 수 있다. 소유자 연결 해제는 관리자 또는 본인만 가능하며 운영 담당자와 미완료 초대도 취소한다. 업체·글·사진·재고·원고는 삭제하지 않는다.
- 마지막 연결이 해제되면 프로필 전환 메뉴가 사라진다. 다른 업체 연결은 유지한다. 앱 복귀·계정 변경에 현재 권한을 다시 확인하고 실패 시 이전 업체 자료를 노출하지 않는다.
- 모든 서버 관리 요청은 현재 계정·업체·역할을 검사한다. 연결 해제와 변경은 업체 행 잠금으로 동시 요청과 직렬화하고 변경 주체·대상·이전/이후 상태·방법·확인 기록을 남긴다.
- private 업체 이미지와 다른 업체 사진의 직접 조회도 검사한다. 이미 조회된 자료는 회수할 수 없으며 발급된 서명 URL은 만료까지 유효하다. 비공개 편집 이미지의 서명 기간을 짧게 유지한다.

## 구현과 검증

1. 기존 로컬 Postgres에서 pgTAP로 직접 연결·초대·업체 격리·운영 담당자 제한·해제·위조/만료/동시 변경을 먼저 재현한다. 신규 migration과 테스트는 rollback되는 트랜잭션에서 실행해 공유 로컬 DB를 보존한다.
2. 순차 migration, 현재 권한 helper, 보안 RPC, 저장소 조회 정책을 연결한다. 새 private 테이블은 RLS를 켜고 직접 접근 권한을 주지 않는다. 기본 search_path를 비우고 기존 안전 검토·작성자 기록을 유지한다.
3. 관리자 연결 화면·앱 초대 확인·전환 진입·운영 담당자 도구를 연결한다. 기존 night/iris와 admin light, 44px·접근성·play 피드백을 유지한다. 이미 확인한 Mobbin Plain 초대 사례(https://mobbin.com/flows/5547be1b-fceb-4104-be4d-21eded14329e)의 계정·역할·초대 대기 구분을 참고한다.
4. 실제 컴포넌트 브라우저 검증, Node 테스트, TypeScript, 변경 lint와 Expo 앱/관리 웹 빌드를 확인하고 output/design에 클릭 가능한 HTML을 남긴다.

소스: supabase/migrations·supabase/tests, src/lib/merchant-connections.ts, 기존 merchant-workspace·admin-merchants·profile 진입. 테스트는 scripts의 기존 Node/Playwright와 Docker의 기존 supabase_db_gling을 사용한다. 새 의존성·서버·worker·일정·결제/OAuth 연동은 추가하지 않는다.

명령: `npm test`, `npx tsc --noEmit`, 변경 파일 `npx eslint`, `GLING_PUBLIC_WEB=0 GLING_LOCAL_ADMIN=0 GLING_MERCHANT_WEB=0 npx expo export --platform web --output-dir output/qa/merchant-connections-2026-10-09/app-build --max-workers 2`. pgTAP는 `docker exec -i supabase_db_gling psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1`에 신규 migration과 테스트를 한 rollback 트랜잭션으로 전달한다.

스타일: 기존 client.rpc(name, { p_merchant_id, ... })와 실제 서버 오류를 재사용한다. 서버가 반환한 명시적인 권한만 표시한다. UI나 JWT의 자체 입력으로 권한을 만들지 않는다. 운영 반영과 실제 계정 연결은 로컬 구현·검증 결과와 구분한다.

## 구현 결과와 실제 확인 · 2026-10-09

- 서버 구현은 `supabase/migrations/0143_merchant_account_connections.sql`. 기존 선행 `0140_merchant_profile_links.sql`, `0142_merchant_customer_mcp.sql`과 함께 검증했다. 기존 게시 함수 하나를 재사용하며 안전 검토·작성자·쿼터·사진 10개 제한을 보존한다. 예상한 함수 서명이나 수정 지점이 달라지면 migration이 실패하도록 했다.
- 관리자의 기본 연결 방식은 **바로 연결**이다. 검색한 회원 UUID·닉네임·이메일과 업체 주소·역할·revision을 확인한다. 초대 후 수락도 선택할 수 있다. 역할 변경·소유자 덮어쓰기는 묵시적으로 처리하지 않는다. 불확실한 응답 후에는 현재 연결을 조회하며 자동 재전송하지 않는다.
- 업체에 남아 있는 사진은 기존 업로더의 연결이 해제돼도 현재 허용된 담당자가 계속 편집할 수 있다. 다른 업체의 사진 경로를 임의로 추가할 수 없으며, 전 담당자의 일반 글 수정·사진 덮어쓰기·삭제 우회도 막는다.
- 계정 탈퇴는 기존 개인 자료 삭제 정책을 유지한다. 계정을 먼저 탈퇴 상태로 고정한 뒤 Storage 삭제 대상을 판별한다. 다른 소유자의 업체에 참조된 파일은 소유 연결을 분리해 보존하며, 판별 실패 시 파일 및 Auth 사용자 삭제를 중단한다. 소유권 변경과 탈퇴가 겹쳐도 새 소유자의 업체 원고·재고가 삭제되지 않도록 업체 행을 잠근다.
- 연결 pgTAP **75개 통과**. 기존 접근 권한 35개·프로필 이미지 102개·고객 MCP 71개·공개 업체 글 95개 및 기존 workspace·이용 후기·근무 후기·listing suite를 확인했다. 동시에 진행 중인 MCP 작업의 검사가 확대돼 최신 선행 migration으로 연결/MCP suite를 다시 실행했고 소스 SHA256이 검사 중 바뀌지 않았음을 확인했다. Node 전체 **523개 통과 / 1개 skip**, 변경 후 관련 검사도 통과했다. 관리자 gateway/MCP Python **12개 통과**, TypeScript 및 변경 lint 오류 없음. Expo 앱과 업체 웹 export, 업체 웹의 관리자 코드 유출 방지 검사 통과.
- 실제 두세 개 DB 세션으로 게시·직접 연결·개인 글 작성, 저장·해제, 소유권 변경·탈퇴를 겹쳐 실행했다. 오래된 업체 revision의 연결은 거부하고, 진행 중인 저장 이후 해제된 담당자의 새 저장은 차단하며, 새 소유자의 자료는 보존했다. 기존 로컬 클러스터의 schema-only 임시 DB만 사용했고 종료 후 삭제했다. 공유 로컬 DB migration/fixture는 rollback했다.
- 별도 읽기 전용 리뷰에서 최신 MCP dispatcher 6개 인자와 게시/검토의 잠금 순서, 현재 소유자 검사 및 운영 담당자 제한을 확인했다. 해당 통합의 Critical/Important 발견 사항은 없었다. 이 리뷰는 소스 검사이며 실제 동시 DB 실행 결과와 구분한다.
- 실제 TSX 컴포넌트로 만든 HTML을 `file://`에서 320·390·768px로 열어 직접 연결·초대 수락·초대 취소·담당자/소유자 해제·오래된 확인 화면을 클릭했다. 화면 오류·가로 넘침·외부 요청 0건. 데이터 및 RPC는 가짜 계정만 사용한다.
- 시안: `output/design/merchant-account-connections.html`. 글링의 실제 소스 worktree `mobile-app` 아래 Orca Browser 탭 `f78810d7-1bbd-44e9-9a7d-0fd8d6610de9`에서 파일 URL·렌더·계정 연결 컨트롤·active 상태·loadError 없음까지 재조회했다. 현재 terminal의 과거 folder ID는 selector로 해석되지 않아, `worktree current`가 확인한 실제 글링 worktree ID로 연결했다. 다른 소셜 탭과 작성 내용은 보존했다.

근거: `output/qa/merchant-connections-2026-10-09/`의 `db-tests.log`, 기존 suite별 로그, `concurrency-results.json`, `node-tests.log`, `python-tests.log`, `types.log`, `lint.log`, `browser-results.json`, `orca-preview.json`, `verification.json`(검증 소스 및 시안 SHA256).

한계: 운영 DB 반영·배포·실제 고객 연결은 수행하지 않았다. iOS/Android 실기기 및 원격 Auth 사용자 삭제는 미확인이다. 이미 발급한 비공개 편집 사진의 서명 URL은 최대 60초 만료까지 유효하고, 조회된 자료는 회수할 수 없다. 기존 `merchant_management.test.sql` 31번(GA4 익명 fixture), `account_lifecycle.test.sql` 17–19번(탈퇴 후 재활성화) 총 4건은 변경 전/후 동일하게 실패했으며 별도 baseline 로그를 남겼다.

## 운영 반영 · 2026-10-09

사용자의 “ㅇㅋ 이대로해” 승인으로 운영 적용을 진행했다. 공유 작업 폴더의 다른 화면 변경을 포함하지 않도록 당시 최신 `origin/mobile-app` (`c2945a341bca176568eee86a17037b045d057f88`)에서 별도 배포 checkout을 만들었다. 기존 관리자 레이아웃에 연결 패널만 추가했다. 별도로 편집 중인 공유 관리자 화면에도 같은 입력 보존 수정만 적용한다.

- 운영 `wjvahbdwmctzpkndqaxa`의 함수·정책·트리거와 기존 delete-account 소스를 보호된 저장소 밖 경로에 백업했다. 기존 함수 전체 329개의 fingerprint 및 migration 이력을 확인한 뒤, 검증된 0142/0143을 먼저 rollback 트랜잭션으로 확인하고 단일 트랜잭션으로 적용했다. 0142는 0143의 필수 보안 통합 의존성이다. 고객 MCP UI·OAuth 제공자 설정·새 클라이언트/동의·서버·일정은 활성화하지 않았다.
- 저장된 운영 migration 이력, RLS·private 테이블 직접 접근 차단, cleanup RPC의 service-only 권한, 익명 HTTP 요청 3개 차단을 조회했다. 기존 실제 MFA 관리자 세션으로 업체 8곳과 신규 연결 목록의 읽기 권한을 확인했다. 낮은 MFA·위조 관리자 UUID는 rollback 검사에서 `ADMIN_REQUIRED`로 거부했다. 비밀번호·갱신·OTP·익명 토큰 훅은 기존 결과와 같은지 확인했다.
- 업체 8곳, 소유자·운영 담당자·초대·연결 감사 기록·원고 모두 0개를 유지했다. 검증을 위해 실제 고객 연결이나 Auth 계정 삭제를 실행하지 않았다.
- delete-account 운영 함수는 v16 `ACTIVE`, `verify_jwt=true`. 계정 고정·업체 자료 정리 후 참조 파일을 판별하는 순서와 다른 소유자의 사진 보존을 반영했다.
- 배포 checkout에서 Node 433개 통과/1개 skip, Python 9개, TypeScript와 변경 lint, 앱·관리자·공개 웹·업체 웹 export 및 관리자 코드 유출 방지 검사가 통과했다. 마지막 리뷰에서 보고서 기간/목록 갱신이 연결 입력을 지우는 문제를 발견해 수정했고, 실제 TSX 회귀 검사 2개는 수정 전 실패/수정 후 통과했다. 재검토에서 남은 Critical/Important 이슈는 없었다.
- 기존 무료 앱 출시 경로에 맞춰 1.1.4 버전과 출시 설명을 준비했다. 기존 iOS 1.1.3은 판매 중이며 Google 내부 테스트 1.1.3(55)은 완료 상태다. 새 앱의 빌드·스토어 제출·심사 승인 결과는 실제 후속 실행 기록과 구분한다.
- 이미지 생성/편집 모델 조사는 적용 대상이 아니다. 이 작업에서는 이미지 생성·편집이나 유료 API 호출을 하지 않는다.

운영 검증 근거는 `output/qa/merchant-connections-2026-10-09/deployment/`에 있다. 운영 DB/권한 및 함수 반영은 확인했으나 실제 고객 연결·원격 Auth 탈퇴·iOS/Android 실기기 전환은 검증하지 않았다. 이전 로컬 pgTAP baseline의 4개 실패와 이미 조회한 자료/발급된 서명 URL 회수 한계는 유지한다. DB 오류는 적용 트랜잭션에서 전부 rollback되도록 했으며, 실제 연결 이후에는 새 private 자료를 삭제하는 rollback 대신 UI 반영 중단과 수정 배포를 우선한다.
