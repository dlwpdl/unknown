# 소상공인 운영 화면과 전체 멤버십 점검

사용자 승인: 일반 회원가입 계정의 프로필에서 업체 대시보드에 들어가 게시물을 벌크 관리하고 원가 계산·재고 관리를 한다. 글링과 외부 한인 카페에 사용할 원고를 준비한다. 기능을 넣은 뒤 전체 멤버십을 점검한다. 원고는 게시글 제목/본문이며 원문 붙여넣기나 직접 작성으로 시작한다.

기존 업체·원문 클릭·서버 집계·관리자 보고서·2FA를 재사용한다. 가정: 업체용은 개인 free/plus/premium과 별도. 가격과 결제 상품은 확정되지 않았으므로 임의 청구 상품이나 개인 플랜 혜택을 추가하지 않는다. 기본 업체/원가/입출고/개별 초안은 무료, 14일 체험 또는 관리자가 승인한 유료 운영은 여러 원고 승인과 운영 보고를 제공하는 초기 구성이다. 체험 종료 이후 자료 열람을 막거나 삭제하지 않는다.

## 구현 단위

- [x] 소유자 권한: 서버 auth.uid로 업체 소유를 연결하고 타 업체·관리자 비공개 메모·임의 유료 상태에 접근할 수 없게 한다. 기존 업체를 이름만으로 가져오지 않는다. 관리자 계정의 업체 작업에도 기존 서버 AAL2 검사를 유지한다.
- [x] 게시물 관리: 글링/캐스모/헬로밴쿠버 채널별 제목·본문·원문을 저장하고 선택한 원고를 한 번에 승인한다. 수정하면 승인을 무효화한다. 글링 공개는 별도 버튼으로 최신 승인본에만 정상 create_post/안전 검사·기존 이용 한도를 적용한다. 같은 draft UUID 재시도는 중복 공개하지 않는다. 카페는 게시할 원고 복사와 실제 게시 URL 기록을 제공하며 그 기록을 플랫폼 검증 발행으로 부르지 않는다. 계정/공식 연동/카페 규칙 검증 전 실제 자동 가입·게시를 수행하지 않는다.
- [x] 원가: 한 번 만드는 묶음의 총 재료비·판매 수량·개당 포장/기타비·판매가·수수료율로 개당 변동 원가·원가율·공헌이익을 계산한다. 실제 순이익으로 표현하지 않는다. 음수·무한값·수량0·수수료100% 이상을 거절한다.
- [x] 재고: 품목·단위·개당 원가·부족 기준을 관리하고 입출고는 불변 기록+원자적 수량 변경으로 처리한다. 요청 UUID를 재사용해 불확실 응답 재시도 때 이중 차감하지 않는다. 음수 재고와 타 업체 품목을 거절한다. 대량 입출고는 전체 검증 후 한 트랜잭션이며 CSV/외부 POS 자동 연동은 별도로 확장한다.
- [x] 프로필의 ‘소상공인’ 진입과 업체 선택·등록, 게시물/원가/재고/성과 화면. 기존 night/iris, 44px, keyboard/reduced motion, feedback와 입력 오류 시 보존을 따른다. 본인 계정 변경 때 다른 업체 자료가 남지 않게 한다.
- [x] 관리자/API/MCP: 기존 업체 관리에서 등록한 회원의 소유 확인과 운영 상태를 관리한다. AI도 같은 서버 검사를 거친다. 비밀번호·OTP·카페 인증정보를 초안이나 분석 데이터에 넣지 않는다.
- [x] 개인/업체/홍보 크레딧의 가격·한도·광고·구매/복원/취소/만료·계정 전환과 실제 스토어 설정을 점검한다. 미연결 상품이나 테스트 상태를 판매 중으로 표시하지 않는다. 사용자 확정 가격/혜택을 임의 변경하지 않는다.

## 구조·검증

`src/lib/merchant-workspace.ts`: 계약·계산·RPC. `src/components/merchant-workspace.tsx`: 기존 RN 컨트롤 기반 화면. `src/app/profile/merchant.tsx`: 프로필 경로. `supabase/migrations/0119_merchant_workspace.sql`: 기존 private.merchants 확장 및 비공개 품목/입출고/초안, 제한된 RPC. 새 서버·패키지·분석 서비스·GUI 잠금 없음.

검사: `node --experimental-strip-types --test scripts/merchant-workspace.test.mjs`; `npm run typecheck`; `npm test`; 변경 파일 ESLint; 기존 로컬 DB에서 rollback pgTAP(타 업체 접근·AAL1 관리자·이중 차감·음수 재고·일괄 승인·변경 후 승인 해제·만료 후 열람·중복 공개). `GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir .admin-dist`; `npm run export:web`; `npm run check:public-web`.

새 GUI/자동화는 기존 공용 gui_bundle·기한·계정·미완료 제출을 보존한다. 운영에는 새 migration만 선택 배포하고 readback한다. native 소스/로컬 검증과 새 App Store/Play Store 배포를 구분한다. HTML 시안은 output/design에 저장한다. 실업체·문의/매출·카페 실제 연동·결제 효과는 구현 테스트와 별개다.

## 2026-10-07 인계 후 반영

일반 계정용 소상공인 화면과 개인 멤버십 감사 수정 소스를 작성했다. 운영 DB에는 0119/0120/0121을 각각 선택 적용하고 함수·권한·기록을 재조회했다. 0120은 관리자 목록의 감사 기록을 PostgREST 쓰기 트랜잭션에서 허용한다. 0121은 검토한 updated_at가 일치하는 원고만 원자적으로 승인·게시·카페 URL 기록한다. 기존 실제 AAL2와 90일 보존 작업은 유지했다. 운영 업체 0개이며 고객 초안·재고·공개 게시를 만들어 검사하지 않았다.

기존 서버 응답을 수정·복제할 때 허용한 RPC 필드만 전송한다. 재고 응답이 불확실하면 계정·업체별 UUID와 payload를 전송 전 저장하고 화면 이동·재시작 후 같은 요청을 복구한다. 저장·읽기·정리 실패는 새 요청을 차단한다. 진행 중 요청을 기다린 재진입은 최신 수량을 다시 읽은 뒤 입력을 연다. 같은 source 해시의 회귀 검사가 통과했다. 최신 저장본이 편집기와 다르면 먼저 다시 열어 확인한다. 최종 화면/소스 검증과 native 배포 영수증은 아래 후속 기록을 따른다.

공개 약관은 PR4 병합과 GitHub Pages 배포 후 실제 /terms를 확인했다. Google 기존 두 상품 설명을 저장·재조회했다. Apple 기존 네 상품의 metadata version2는 새 설명 8개를 저장하고 심사 대기 중이다. 가격·SKU·basePlan·기간 변경과 실제 구매는 없다. 개인 Premium과 업체 Pro는 별도이며 업체 결제 상품은 아직 만들지 않았다.

현재 공개 앱은 1.1.2다. 1.1.3은 새 소스의 빌드·제출 예정이며, 빌드/업로드/심사/실제 출시를 구분한다. 네이티브 Share sheet·음수 키패드·실제 승인 대기 취소는 기기 검증을 마친 것으로 표시하지 않는다.

검사 영수증: output/qa/merchant-workspace-2026-10-07/resume-production-0119-attempt.json, resume-production-0120-attempt.json, resume-production-0121-attempt.json, resume-draft-revision-db-final.log, resume-rpc-fields-final.log, resume-public-terms-live.json, store-copy-completion-20261007.json.

## 최종 출시 소스 검증

원격 최신 mobile-app의 격리 checkout에서 이번 기능/멤버십 수정만 골라 검증했다. 전체 lint·typecheck·Node305개, 공개 웹 export·관리자/앱 코드 누출 검사 통과. 관련 업체·MFA DB91개, 개인 멤버십·관계 DB107개와 별도 슬롯23개가 통과했다. 실제 MCP18개 schema/연결·운영 관리자 HTTP 목록0개를 확인했다.

실제 작성 소스의 RNW16layouts/16behavior checks, 컨트롤44px, 가로 넘침·브라우저 오류·외부 요청0건을 확인했다. 불확실한 동일 요청은10→8 한번만 적용되고 업체 이동·JS재시작에서 UUID/payload를 복구한다. 진행 중 요청 완료 후 다시 연 화면은 최신 수량을 재조회한다. 다른 경로의 A→B 원고 변경은 입력A를 보존하고 승인/게시/복사/URL 기록을 막으며, 직접 최신본B를 다시 열도록 안내한다. 독립 리뷰의 열린 Critical/Important는0건이다.

로컬 재실행: node output/qa/merchant-workspace-2026-10-07/check-rendered-workspace.cjs. 이 Mac에 설치된 기존 Playwright와 .admin-dist의 RNW 런타임을 사용하며 실제 Supabase/결제/OS공유를 호출하지 않는다. 증거: rendered-workspace-evidence.json, rendered-persistence-revision-final.log.
