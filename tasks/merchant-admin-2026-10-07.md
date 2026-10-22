# 업체 관리·원문 클릭·고객용 보고서

사용자2026-10-07 구현 지시: 기존 어드민에서 업체 등록/관리, 대행 글과 원문 연결, 글 수·성과 확인, 보고서 작성/저장/내보내기와 기간제 결제 제안까지 가능하게 한다. 연락은 사용자가 보고서를 전달하는 흐름이며 이번 작업에서 외부 발송·과금하지 않는다.

가정: 관리자 전용 웹과 기존 Supabase/RPC/감사를 재사용한다. 업체의 연락처·허락 근거는 비공개다. 업체 등록은 실제 허락이나 결제의 증거가 아니며 상태로 구분한다. 새 의존성·분석 SaaS·자동화는 추가하지 않는다. 기존 checkout의 다른 변경과 기존 출시 build54를 보존한다.

조정 포함 표시 조회수는 사용자 최신 지시에 따라 보고서에 포함한다. 실제 열람/원문 클릭으로 바꿔 표현하지 않는다. 과거 익명/조정분은 정확히 분리할 수 없으므로 차이를 조정 건수라고 추정하지 않는다. 표시에 쓰는 누적 수치와 기간 내 기록을 명시한다.

성공 기준:
- [x] 어드민 ‘업체 관리’에서 이름·도시·담당 연락처·운영 상태·허락 상태/근거를 저장하고 재조회한다.
- [x] 기존 게시글을 원문 URL과 연결하거나 정상 create_post 경로로 새 대행 글을 작성한다. 업체 허락이 필요하며 기존 글은 보존한다.
- [x] 허락된 활성 업체의 공개 글 상세에 ‘원문으로 가기’가 표시된다. 앱/공개 웹에서 클릭 시 원문을 열고 게시글별 실제 클릭을 기록한다. 실패한 분석 요청은 이동을 막지 않는다.
- [x] 관리자·작성자·seed·심사·테스트 반응을 제외한다. 재전송을 중복 집계하지 않고 익명 세션과 로그인 계정을 분리한다. 외부 문의/주문 완료를 추정하지 않는다.
- [x] 업체의 글 목록/수, 누적 표시 조회수(조정 포함), 기간 내 로그인 최초 열람과 원문 클릭을 보고서에서 구분한다.
- [x] 보고 기간·설명·개선안·2주/월 CAD 견적·세금 안내를 편집하고 서버 집계의 snapshot과 함께 저장한다. 저장된 보고서를 다시 열어 standalone HTML 다운로드·브라우저 PDF 인쇄가 가능하다.
- [x] 업체 내부 자료·원자료는 관리자 전용. 공개 RPC는 허락된 공개 글의 안전한 HTTPS 원문과 실제 클릭 기록만 처리한다. 서버 권한 검사·감사·삭제/보관 정책을 유지한다.

순서: 계약/보고서 단위 검사 → 비공개 DB/RPC와 pgTAP → 어드민 및 앱/웹 원문 버튼 → 타입/단위/DB/공개 빌드 검사 → 기존 로컬 어드민 출력 갱신·실제 Orca 검증. 실제 iOS/Android 적용은 신규 스토어 빌드 배포와 구분한다.

명령: `node --experimental-strip-types --test scripts/admin-merchants.test.mjs`; `npm run typecheck`; `npm test`; `npx supabase test db`; `GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir .admin-dist`; `npm run export:web`; `npm run check:public-web`.

파일: `src/lib/admin-merchants.ts` 계약/보고서, `src/lib/merchant-source.ts` 안전 URL/원문 클릭, `src/components/admin/admin-merchants.tsx` 어드민, `src/components/merchant-source-link.tsx` 앱 버튼, 기존 어드민 라우팅과 공개 reader, migration0117와 관련 테스트. 입력 검증과 기존 async/RPC 에러 처리를 따른다.

디자인: 관리자 기존 light table/forms를 유지하고 고객 보고서는 현재 night/iris+Menlo 기준. 실제 [Attio 목록](https://mobbin.com/screens/d366c322-a0fe-41fb-a62b-0da0ffb80259), [folk 업체 목록](https://mobbin.com/screens/9de54f66-61ac-4ad9-86d1-a6c717cb4e90)의 목록→업체 선택→행동 구조를 참고했다. BrandKit의 현재 색/서체를 확인했고 Pinterest를 조사했다. Kroma는 기존 Serper 키가 없어 실패했으며 새 서비스/키를 구매하지 않는다. 새 버튼/선택에는 기존 interaction feedback, 키보드·44px·오류/빈 상태·반응형을 적용한다. 검토용 HTML은 output/design에 저장한다.

근거: Expo57 공식 문서2026-10-07 확인, Supabase 함수/권한 문서와 설치된 Postgres·명세/증분/TDD·UI/Apple Design/Ponytail 스킬. 소수 실제 업체 운영·실제 결제·매출 효과는 기능 검증과 별개다.

## 후속 지시와 완료 범위

사용자가 AI가 관리하기 쉬운 API/MCP와 항상 관리자 2FA를 요청했다. 같은 RPC를 쓰는 9개 stdio MCP 도구를 구현·현재 Orca Codex 계정에 등록했고, 기존 로컬 어드민 서버에 같은 origin의 인증 연결/해제 경로를 추가했다. 설치된 MCP SDK/Node와 Mac Keychain을 재사용하고 Supabase access token만 저장한다. 새 인증 서비스·패키지·조정 데몬·native 예약 작업은 만들지 않았다. 인증 방식 선택의 답변이 없어 이미 활성화된 Supabase TOTP로 진행한다고 알렸다.

위 체크는 구현/격리된 테스트에서 확인한 기능이다. 운영 DB는 0117/0118만 선택해 적용하고 실제 함수·테이블 권한·보관 작업을 재조회했다. 기존 cron23/29 8 * * */postgres/active를 유지해 90일 클릭 삭제만 추가했다. 익명 관리자 조회와 저장 HTTP401, 공개 미등록 글의 원문 조회 null을 확인했다. 실운영 업체·보고서·클릭은 모두0이며 가짜 업체/측정치를 넣지 않았다.

최종 검사: TypeScript·변경 ESLint·단위298/298·pgTAP 업체34/34+MFA8/8·Python 연결6/6·실제 MCP stdio9개 도구·공개/비공개 export·공개 번들 private 코드 차단 통과. 테스트 로그와 선택 배포의 소스 해시는 `output/qa/merchant-admin-2026-10-07/`에 있다. QR은 실제 설치 SDK가 반환하는 data URI 형식과 # 색상 문자를 함께 검사해 수정했다. 토큰 갱신 시 게이트가 편집기를 재마운트해 미저장 내용을 지우던 문제는 실제 listener 분기의 RED/GREEN 회귀 검사로 수정했다. 입력칸의 content-box 때문에 겹치던 폭은 해당 컴포넌트에만 border-box를 적용했다. 고객용 HTML exporter를 명시된 시안 fixture로 실행했으며 실제 고객 성과로 기록하지 않는다.

- [x] 소유자가 실제 2FA 등록·로그인을 완료했다고 확인했다. 인증한 화면의 AI 연결과 실제 MCP 업체 목록 조회가 성공했다. 인증 비밀은 대화/파일에 전달하지 않았다.
- [ ] 실제 허락받은 업체로 앱/웹 원문 클릭과 보고서를 대조한다. 새 원문 버튼은 다음 iOS/Android 빌드에 반영해야 한다. 공개 export의 원격 배포도 이번에는 실행하지 않았다.

계약/운영법: `docs/specs/merchant-admin-api.md`. 시안: `output/design/gling-merchant-report-preview.html`. 업체 연락·결제·실제 BM 성과·앱스토어 신규 출시와 기능 검증을 구분한다.

MCP 등록 유지 문제도 확인했다. Orca 생성 계정 설정이 다시 쓰여 초기 등록이 사라져 공식 프로젝트 설정을 사용했다. 기존 폴더 CWD인 `/Users/ash/Desktop/Git/.codex/config.toml`과 Gling Git 저장소의 `.codex/config.toml`에서 같은 이름의9개 도구 서버를 등록하고 각각 CLI 실제 유효 설정을 재조회했다. 예약 자동화나 모델/권한 설정은 변경하지 않았다.
