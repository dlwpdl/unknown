# Implementation Plan: 글링 Supabase 백엔드 v1

## B안 동네 저널 리디자인 — 2026-09-07

승인된 B 시안과 A의 읽기 편한 텍스트 구성을 `journal-redesign-spec.md` 기준으로 실제 앱에 반영한다.
기존 피드 순서에서 첫 사진과 모임을 중복 없이 묶는 회귀 검사를 먼저 만들고, 오늘 피드/도시 시트와 공유 PostCard를 독립적으로 수정한다.
작성 횟수는 작성 화면으로 옮기고 네이티브 탭·권한·안전 동작을 보존한다. 전체 검사와 iOS/Android 번들·실제 시뮬레이터 화면을 검증한다.

## Release preparation — 2026-09-06

Use only `dlwpdl/gling` (`mobile-app`). Follow ROTTERY's existing release deliverables: store metadata, native screenshots, a verified iOS build, and an evidence-based submission checklist. Reuse Gling's Expo configuration, public policy pages and Supabase backend.

1. Check installed SDK compatibility, existing unit/DB tests and production authentication settings. Fix only reproduced release blockers.
2. Verify an iOS Release build and capture actual simulator screens. Keep build products outside version control.
3. Prepare Korean store metadata, privacy/age-rating drafts, review instructions and exact remaining account/device checks. Document rollback and push verified changes to the existing repository.

Acceptance: commands and artifacts are reproducible; no claim of working production Apple login, successful signing, TestFlight upload or store submission without direct verification. Preserve ADR-0001's full-content safety monitoring and explicit AI consent.

## Android registration — 2026-09-06

Reuse the existing Eunsense Studio Play Console account and `dlwpdl/gling`. Check for an existing app before creating its listing. Set Android package `com.dlwpdl.gling`, build a signed API 36 Android App Bundle with local native tools, and upload a draft/internal-test release. Keep upload keys outside Git. Reuse the Korean description and policy URLs; verify Android-specific permissions and login behavior, and record actual Console state without claiming public release.

## Overview

기존 만남 중심 SQL 초안을 일상 공유 중심 스키마로 줄이고, RLS와 정책 테스트를 먼저 완성한 뒤 Expo 클라이언트를 연결한다.

## Architecture Decisions

- 별도 API 서버 없이 Supabase Data API와 Postgres RPC를 사용한다.
- 하루 한 편과 신고 대상 확정처럼 우회되면 안 되는 규칙만 DB 함수/트리거로 강제한다.
- 관리자는 service-role 키가 아니라 서버가 발급한 `app_metadata.role` 클레임으로 판정한다.
- 이미지 바이너리는 DB가 아니라 비공개 Storage에 두고 DB에는 경로만 저장한다.

## Dependency Graph

`스키마·RLS → pgTAP 정책 검증 → Supabase 클라이언트 설정 → Auth → mock 교체`

## Phase 1: Database Foundation

- [x] 현재 기획에 맞춘 스키마·인덱스·Storage 버킷 작성
- [x] 하루 한 편, 1:1 대화, 신고·관리자 처리 RPC 작성
- [x] 모든 공개 테이블에 최소 grant와 RLS 적용

### Checkpoint

- [x] 빈 로컬 DB에서 migration 적용 성공

## Phase 2: Security Verification

- [x] 소유자/타인/관리자/방 멤버 경계 pgTAP 테스트 작성
- [x] DB 테스트와 advisor/lint 실행

### Checkpoint

- [x] 허용·거부 정책 테스트 통과

## Phase 3: App Connection

- [x] Expo용 Supabase 클라이언트와 환경 변수 예시 추가
- [ ] 생성된 Database 타입을 앱에서 사용할 준비

### Checkpoint

- [x] TypeScript와 신규 Supabase 코드 lint 통과

## Phase 4: Initial Content and Admin

- [x] mock 데이터와 1:1 대응하는 seed migration 및 pgTAP 검증
- [x] 로컬 검증 후 원격 프로젝트에 seed migration 적용
- [x] 실제 사용자 초대 후 `app_metadata.role = 'admin'` 지정

### Checkpoint

- [x] 원격 데이터 개수와 관리자 역할을 읽기 전용 쿼리로 검증

## Phase 4.5: Category Taxonomy

- [x] 피드와 글쓰기를 9개 대분류로 통일
- [x] 기존 mock·운영 글을 내용에 맞는 대분류로 이관
- [x] 앱 단위 검사와 DB migration 검증

## Phase 4.6: Trending Hashtags

- [x] 도시·대분류별 사용 빈도를 추천 태그보다 먼저 노출
- [x] 동네 한/영문·오타 별칭을 대표 표기로 통합
- [x] 자유 입력을 중복 없이 최대 5개로 제한

### Checkpoint

- [x] 별칭 검색과 입력·추천 회귀 테스트 통과

## Phase 4.7: AI-assisted Writing

- [x] 사진 촬영·선택과 미리보기
- [ ] 인증된 Edge Function에서 이미지 기반 구조화 초안 생성 (코드 완료, `OPENAI_API_KEY` 설정·배포 대기)
- [x] 제목·본문·대분류·해시태그를 수정 가능한 상태로 채움
- [x] 사용자당 하루 5회 서버 제한

## Phase 5.5: Sharing and Onboarding

- [x] 공유 횟수와 운영 주소/딥링크 생성
- [x] 공유 글 게스트 보기와 상호작용 로그인 게이트
- [x] 카카오 정보 또는 직접 입력 프로필 생성
- [x] 한글·영문 두 단어 랜덤 닉네임

### Checkpoint

- [x] 앱과 원격 DB에 동일한 9개 대분류만 존재

## Phase 5: Authentication Foundation

- [x] 앱 식별자와 딥링크 scheme을 `gling`으로 통일
- [x] mock 인증 상태를 Supabase 세션으로 교체
- [x] 카카오 로그인·세션 복원·로그아웃 연결
- [x] 첫 로그인 후 닉네임·지역 프로필 생성 흐름 연결

### Checkpoint

- [ ] 앱 재실행 후 세션이 유지되고 사용자별 RLS가 적용됨

## Phase 6: Kakao Login

- [x] 앱에는 카카오 로그인만 노출
- [ ] Kakao OAuth 공급자와 `gling://auth/callback` 연결
- [ ] 카카오 계정 탈퇴·연결 해제 운영 흐름 마련

### Checkpoint

- [ ] 카카오 로그인과 로그아웃이 실제 기기에서 동작

## Phase 7: App Data Connection

- [x] 공개 피드·댓글 시드를 Supabase 쿼리로 교체
- [ ] 새 글·댓글·저장·대화를 Supabase 쓰기로 교체

### Checkpoint

- [ ] 실제 로그인 계정으로 글 작성부터 신고·관리자 조회까지 동작

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 관리자 JWT 역할 변경이 즉시 반영되지 않음 | 권한 회수 지연 | 역할 변경 후 세션 갱신·강제 로그아웃 운영 절차 |
| 메시지/피드 증가 | 쿼리 지연 | 작성자·방·커서 페이지네이션 인덱스 선반영 |
| Supabase 프로젝트 정보 없음 | 클라우드 적용 불가 | 로컬 migration과 테스트까지 완료 후 연결 |
| 시드 계정을 실제 사용자로 오인 | 보안·운영 혼선 | 로그인 identity 없이 콘텐츠 작성자 FK로만 사용 |
| 과거 모임 mock이 현재 범위를 확장 | 불필요한 채팅 스키마 | `room_preview` JSON만 보존하고 실제 기능은 보류 |
| OAuth 앱 콜백 불일치 | 로그인 후 앱 복귀 실패 | scheme과 Supabase Redirect URL을 `gling://auth/callback`으로 통일 |
| 카카오 단일 로그인으로 iOS 심사 제출 | 심사 거절 가능성 | 제출 전 최신 App Store 로그인 정책을 다시 확인 |

## Open Questions

- Kakao 개발자 콘솔 자격 증명은 공급자 설정 단계에서 받는다.

## Phase 8: Admin Web MVP

- [x] 관리자 역할 판정과 웹 전용 `/admin` 로그인 게이트
- [x] 전체 신고·사용자·게시글·대화 조회와 사용자 활동 상세
- [x] 신고 처리와 관리자 열람 감사 로그
- [x] 반응형·접근성·브라우저 및 빌드 검증

### Checkpoint

- [x] 일반 사용자는 차단되고 관리자만 전체 데이터와 신고 처리 기능에 접근
- [x] `npm run test:admin && npm run typecheck && npm run lint && npx expo export --platform web` 통과

## Phase 9: Complete User Flow Integration

- [ ] 개발용 실제 Supabase 세션과 웹 세션 영속화
- [ ] 게시글·이미지·일일 서버 쿼터 연결
- [ ] 신고·차단·댓글·공감·저장·조회·공유 연결
- [ ] AI 초안 함수 배포와 비밀값 검증
- [ ] 1:1 DM·모임 신청·Realtime 메시지 연결
- [ ] HTTPS 공유 글과 단일 공개 글 조회
- [ ] 실제 프로필·저장글·통계와 설정 라우트 가드
- [ ] 모바일 웹 내비게이션 겹침 제거
- [ ] 전체 사용자 DB 흐름 테스트와 런타임 검증

### Checkpoint

- [ ] 가입 → 작성 → 상호작용 → 신고 → 관리자 확인 → 대화가 실제 DB 데이터로 이어짐

## Phase 10: Community Hardening

- [ ] 수정 콘텐츠 안전 재검토와 AI 안전 Worker
- [ ] 공유·해시태그·댓글·메시지·대화 생성 어뷰징 제한
- [ ] 모임 신청 → 승인/거절 → 대화 생성 상태 전이
- [ ] 인앱 알림과 관리자 경고/차단 조치
- [ ] 네이티브 글쓰기 진입, 탈퇴·재가입 잠금, 고객문의 자리
- [ ] 피드·댓글·저장글·대화 커서 및 가상 리스트 성능 개선

### Checkpoint

- [ ] `tasks/community-hardening-spec.md` 성공 기준과 전체 자동 검증 통과

## 구독 도입 검토 — 2026-09-09

상태: 향후 도입을 위한 검토. 사용자는 하루 글 작성 1·2·5편, 모임과 1:1 대화는 각각 3·5·10으로 등급별 수치를 지정했다. 플러스보다 프리미엄의 선택 가치를 크게 만드는 것이 상품 구성의 목적이다. 모임 참여가 과도해지거나 도배를 유도하는 멤버십은 원하지 않는다. 무료 이용은 반드시 유지하고 광고·선택형 멤버십·주거/중고 등의 게시글 상단 홍보를 수익원으로 검토한다. 공개 게시판 활성화 후 모임에 집중하는 방향과 당근 참고 내용은 [공개 게시판·모임·수익모델 검토](community-direction-2026-09-09.md)를 따른다. 아래 모임·대화 집계 단위와 가격·시점은 제안이다. 결제 코드, 상품 등록, 계약 동의는 진행하지 않았다. 현재 Expo 앱에 결제 SDK/구독 상태 모델은 없다. 기존 서버의 `daily_post_limit`는 재사용 가능한 작성 한도이며 결제 여부를 뜻하지 않는다.

게시글 홍보의 사용자 지정 기준: 무료 회원도 개별 구매하며, 자연 노출을 제외한 추가 홍보 노출 횟수를 채우면 자동 종료한다. 900원/900회와 1,700원/1,700회는 사용자 설명용 예시로 기록하며 확정 판매가로 사용하지 않는다. 기존 기간제 홍보 제안은 대체한다. 실제 화면 노출의 인정 기준, 반복 노출·중복 이벤트 처리, 미소진 수량 처리와 현지 가격은 위 검토 문서에서 별도로 정의한다.

### 연결 준비 상태 — 2026-09-09 직접 확인

- 코드: Expo `~57.0.20`, 양 플랫폼 식별자 `com.dlwpdl.gling`. 결제 SDK·구독/홍보 구매 처리가 없다. 서버의 `profiles.daily_post_limit`, `create_post`, `get_post_quota`를 글 한도 연결에 재사용할 수 있다. 모임·새 대화 한도와 홍보 집계는 별도 구현이 필요하다.
- Apple: 기존 `asc` 5.0.0의 `gling` 인증으로 앱 `6809273242`를 조회했다. `asc --profile gling subscriptions groups list --app 6809273242 --paginate --output json`과 `asc --profile gling iap list --app 6809273242 --paginate --output json` 모두 `data: []`, 총 0개다. API 접근은 가능하지만 Paid Apps Agreement·세금·은행 등록 상태는 확인하지 못했다. 현재 `asc agreements`는 EULA 지역 조회만 제공하고 기존 글링 브라우저 탭은 로그인 화면이다.
- Google: 기존 글링 Orca 탭에서 **Play를 통한 수익 창출** 화면을 직접 열어 “이 앱으로 수익을 창출하려면 판매자 계정을 설정하세요.”를 확인했다. 글링 판매자 결제 프로필 설정이 먼저 필요하다. 가입·계약 동의·금융 정보 입력은 수행하지 않았다.
- 연결 구성: 실제 결제는 StoreKit / Google Play Billing, 구매·갱신 검증은 사용자가 도입을 승인한 RevenueCat으로 준비한다. 기존 Supabase에서 글링 계정별 혜택과 홍보 잔량을 관리한다. 새 BaaS나 광고 거래 서버는 추가하지 않는다. RevenueCat 프로젝트는 준비했으며 스토어 연결 키는 아직 연결하지 않았다.
- 사용자 후속 결정 및 실행: 무료 구간과 이후 수수료를 설명한 뒤 “가입해서 쓰자”는 지시로 RevenueCat 도입을 승인했다. 사용자가 브라우저에서 계정을 만든 후 “폼채워줘” 요청에 따라 소개 폼을 `Gling / Social Networking / 신규 인앱 구매 앱 / Founder · Executive / React Native`로 제출했다. `Git → gling`의 기존 탭에서 [Gling 프로젝트 대시보드](https://app.revenuecat.com/projects/db748917/overview)를 확인했다. 프로젝트 ID는 `db748917`, 이메일 인증 안내가 남아 있고 초기 설정은 0/6, Test Store 상태다. 기본 제안인 Gling Pro·평생 상품은 채택하지 않았다. 스토어 연결·SDK 설치·실결제는 미완료이며 카드나 개인 이메일을 임의로 등록하지 않았다.
- 가입 이메일 후속 확인: RevenueCat 계정 설정의 주소는 `gling@ej-entertainment.com`이다. 사용자가 포워딩 설정을 완료한 뒤 인증 메일을 재발송했다. 사용자의 인증 완료 통보 후 대시보드를 새로 열어 미인증 경고가 사라진 것을 확인했다. 가입·프로젝트 생성·이메일 인증은 완료다.
- 스토어 연결 후속 확인: RevenueCat의 App Store 연결 폼에서 앱 이름 `Gling (App Store)`와 Bundle ID `com.dlwpdl.gling`을 준비했다. 저장에는 `SubscriptionKey_*.p8` 형식의 인앱 구매 전용 키 및 Key ID·Issuer ID가 필요하다. 다운로드·글링 자격 증명 폴더에서 해당 키를 찾지 못했으며 저장·연결 검증은 하지 않았다. 기존 App Store Connect 탭은 로그인 화면이라 `Git → gling`에서 실제 화면을 띄웠다. Google Play 결제 프로필 화면에도 생성 필요 안내가 남아 있다.
- 상품 구분: 플러스·프리미엄은 자동 갱신 구독, 횟수형 내 글 홍보는 반복 구매 가능한 소모성 인앱 상품이다. 홍보 상품을 영구 멤버십 권한에 연결하지 않는다. RevenueCat은 구매를 검증하지만 홍보 횟수 차감·중복 방지·목표 도달 종료는 글링 서버 책임이다. AdMob 연결은 이 두 구매 기능의 선행 조건이 아니다.
- 연결 자격: Apple의 In-App Purchase 전용 키와 Google Play 권한이 있는 서비스 계정 및 서버 알림 연결을 준비한다. 기존 ASC 배포 API 키가 구매 검증용 키를 대신한다고 가정하지 않는다. 비밀 키는 앱/저장소에 포함하지 않는다.
- 실행 순서: 상품/한도 정의 → 판매자·스토어/RevenueCat 연결 준비 → 테스트 구독 1건의 구매·혜택·만료까지 검증 → 양 플랫폼/전체 등급 확대 → 홍보 구매·글 연결·유효 노출 소진/종료 검증 → 실제 상품 가격과 중단·환불 정책 확정 후 새 빌드/심사. 네이티브 결제 SDK를 포함한 새 빌드가 필요하며 웹 미리보기나 Expo Go의 모의 결제로 스토어 결제를 검증했다고 하지 않는다.

근거: [Expo 결제 라이브러리와 개발 빌드](https://docs.expo.dev/guides/in-app-purchases/), [RevenueCat Expo 연결](https://www.revenuecat.com/docs/getting-started/installation/expo), [소모성 구매·서버 잔량 관리](https://www.revenuecat.com/docs/platform-resources/non-subscriptions), [Apple 구매 전용 키](https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration), [Google 서비스 계정 연결](https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials), [Apple 유료 앱 계약](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/). 이번 작업은 코드·계정의 연결 준비 상태 확인이며 결제 기능 구현이나 상품 판매 개시가 아니다.

### 상품 구성 가안

한 구독 시스템에서 `기본 / 플러스 / 프리미엄` 세 등급을 지원하는 방향이다. 하루 글 1·2·5편과 모임·1:1 대화의 3·5·10은 사용자 지정이며, 모임·대화 집계 단위와 광고 혜택·가격은 가안이다. 아직 앱에 구현된 멤버십 제한은 아니다.

| 항목 | 기본 | 플러스 | 프리미엄 |
|---|---|---|---|
| 새 게시글 발행 / 하루 | 1편 | 2편 | 5편 |
| 동시에 참여 중인 모임 | 3개 | 5개 | 10개 |
| 먼저 시작하는 새로운 1:1 대화 / 하루 | 3명 | 5명 | 10명 |
| 이미 연결된 대화의 답장·메시지 | 멤버십 횟수 제한 없음 | 동일 | 동일 |
| 가입한 모임의 단체 대화 | 참여에 포함 | 동일 | 동일 |
| 인앱 광고 제거 | 미포함 | 포함 제안 | 포함 제안 |

사용자가 강조한 핵심 가치는 모임에 참여하고 관심사가 맞는 사람을 만나는 것이다. 이를 지속적으로 이용할 수 있는 활동 범위가 멤버십 혜택이며, 글 한도는 참여를 조절하는 규칙이다. 광고 제거는 보조 혜택으로 둔다. 플러스는 가볍게 한도를 늘리는 단계, 프리미엄은 플러스 대비 글 2.5배·모임과 새 대화 각 2배로 활동 여유가 확실한 단계다. 사용자는 프리미엄 선택을 유도하는 구성을 원한다. 실제 만남 성사·답장·모임 가입 승인을 결제로 보장하지 않는다. 실제 전환 우위는 검증 전이다.

### 가격·결제 기간 제안

사용자는 주·월·연 구독 도입 여부와 가격을 질문한 뒤 CA$4.99가 너무 낮은지 물으며 모임과 사람을 만나는 가치를 강조했다. 기존 CA$4.99 / CA$7.99는 낮은 진입 가격을 우선한 비교안으로 남기고, 아래의 높은 가격 후보를 검토한다. 소비자의 지불 의향이 새로 검증된 것은 아니며 어느 안이 매출·유지율에 유리한지는 미정이다. 초기 권장 기간은 유료 두 등급에 월·연 결제를 제공하는 총 네 가지 선택이다. 무료 기본 등급으로 체험할 수 있고 지역 커뮤니티의 지속 이용을 목표로 하므로 주 구독은 단기 체류자의 반복 수요가 확인될 때 검토한다. 아래는 캐나다 스토어 기준 CAD 제안 가격이며 사용자 확정이나 상품 등록은 하지 않았다.

| 유료 등급 | 매월 결제 | 매년 한 번 결제 | 연간 금액의 월 환산 |
|---|---|---|---|
| 플러스 | CA$9.99 | CA$99.99 | 약 CA$8.33 |
| 프리미엄 | CA$14.99 | CA$149.99 | 약 CA$12.50 |

- 프리미엄 추가 비용은 월 CA$5 또는 연 CA$50이다. 월 가격은 약 1.5배, 글 한도는 2.5배, 모임·새 대화 한도는 2배라 상위 등급의 가치를 설명하기 쉽다는 가설이다. 가격을 올린 뒤의 실험 결과가 아니라 비교할 제안이다.
- 연간 가격은 같은 등급을 월 결제로 12회 이용하는 금액보다 약 16.6% 낮다. 월 환산액과 연간 한 번에 결제되는 총액을 구분한다. 결제 기간이 바뀌어도 일일 글 수나 모임·대화 한도는 동일하며 사용량을 연 단위로 미리 지급하지 않는다.
- 수수료 검토: Google Play 자동 갱신 구독의 표준 수수료는 15%. Apple은 Small Business Program 가입 승인 시 15%, 일반 조건에서는 구독자의 첫 1년 30%, 이후 15%다. 현재 계정의 소기업 승인 여부는 이번 검토에서 확인하지 않았다. 세금 등을 제외하고 수수료만 단순 적용하면 프리미엄 월 CA$14.99에서 15%일 때 약 CA$12.74, 30%일 때 약 CA$10.49가 남는다. 순이익을 뜻하지 않는다.
- 가치 검증: 단순히 가격을 올리면 가치가 올라간다고 가정하지 않는다. 실제 참여할 만한 활성 모임, 새 대화에 대한 답장, 반복 참여와 유료 갱신이 뒷받침되는지 확인한다. 무료 회원도 기본 범위에서 참여와 소통을 지속할 수 있어야 유료 회원의 연결 기회도 유지된다. 목데이터와 가입 수만으로 가격을 정당화하지 않는다.
- 판매 전 확인: 실제 스토어 캐나다 가격 포인트, 현지 세금, 서버·사진·콘텐츠 검토 원가, RevenueCat 비용과 광고 기회비용을 확인한다. 원가·수요·전환·유지율 근거가 아직 없어 가격은 확정하지 않는다. 다른 국가의 가격은 현지 통화와 스토어 가격 설정을 따로 확인한다.

가격 근거: [Google Play 수수료](https://support.google.com/googleplay/android-developer/answer/112622?hl=en-CA), [Apple 구독 수익 배분](https://developer.apple.com/app-store/subscriptions/), [Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/). 제안 판매가는 경쟁사 가격이나 검증된 지불 의향을 뜻하지 않는다.

### 집계와 운영 기준

- 하루 한 편: 기본 이용자의 리듬은 1편, 플러스 2편, 프리미엄 5편으로 제한한다. 회원 등급만으로 일반 글의 추천 순위를 올리지 않고, 사용자가 요청한 특정 게시글 상단 홍보는 광고로 표시하는 별도 구매 상품으로 검토한다. 무제한 글쓰기는 제공하지 않는다. 모든 회원이 매일 한도를 쓰고 90%가 기본·10%가 프리미엄이라는 가정에서는 프리미엄의 글 비중이 약 36%다. 실제 이용 수치를 뜻하지 않으며 피드가 소수 회원에게 치우치는지 확인할 이유로만 사용한다.
- 도배 방지: 글 작성 한도는 계정 전체에서 합산하며, 참여 모임 수만큼 곱해지지 않는다. 모임 탈퇴·재가입, 글 삭제·재등록으로 작성 한도를 되돌리지 않는다. 같은 내용을 여러 곳에 반복 등록하는 행위와 메시지 도배 제한은 결제 등급과 무관하게 적용한다. 모임 가입과 개설은 별도 동작으로 검증하고, 개설 가능 수는 이번 3·5·10 참여 한도 지정만으로 확대하지 않는다.
- 모임: 가입/참여가 확정된 진행 중 모임을 세고 내가 연 모임도 참여 한 자리로 포함한다. 종료·취소·탈퇴하면 자리가 비고, 가입 신청 대기는 결제 한도와 별도의 신청 남용 제한으로 다룬다. 승인 시 최종 한도를 다시 검사한다. 현재의 모임 모집글도 새 피드 글로 발행하면 당일 글 한도에 포함하는 가안이다.
- 채팅: 방 총수 3개보다 하루에 먼저 요청하는 새 상대 3명을 권한다. 기존 대화 재입장·상대가 먼저 보낸 요청의 수락·답장·모임 단체 대화는 차감하지 않는다. 기존의 모임 승인 후 호스트와 연결되는 대화도 모임 참여에 포함한다. 같은 상대에게 재요청하거나 방을 나갔다가 다시 열어 한도를 되돌리지 않는다. 멤버십과 무관하게 차단·신고·메시지 속도 제한을 적용하며 결제가 응답을 보장하지 않는다.
- 기간과 복귀: 일일 한도는 서버가 정한 기존 도시 시간대 기준을 사용하고 앱 날짜/도시 변경으로 초기화되지 않게 검증한다. 업그레이드는 검증된 등급의 한도에서 그날 이미 쓴 양을 뺀다. 구독 만료·하향 변경 후에도 글·모임·대화를 지우거나 기존 참여를 강제로 끊지 않고, 새 활동만 낮아진 한도에 맞춘다. 모임 수가 새 한도보다 많으면 기존 모임 종료/탈퇴 전까지 추가 가입을 제한한다.
- 검증: 초기에는 실제 회원의 작성 한도 도달, 네 번째 모임 참여 의도, 새 대화 요청의 답장률, 주간 재방문과 차단·신고 비율을 확인한다. 시드 콘텐츠·심사 계정은 제외한다. 대화가 줄거나 외부 연락처로 바로 이동하는 반응이 보이면 채팅 제한을 완화한다. 상위 등급은 더 넓은 활동 범위에 반복 수요가 생길 때 판매한다.

### 구현 방향

#### 2026-09-09 구현 착수 — 사용자 “그 구독 기능 넣어야지”

- 목적/완료 기준: 무료·플러스·프리미엄을 RevenueCat 구매/복원과 서버에서 검증한 혜택에 연결한다. 하루 글 1/2/5, 모임·대화 3/5/10을 적용한다. 가격·판매 기간과 대화 집계 단위는 사용자 답변 대기이며 해당 결정에 의존하지 않는 구매 검증부터 구현한다. 글 홍보 구매는 별도 상품으로 이 구독 구현에 섞지 않는다.
- 구조/스타일: 기존 `src/lib`의 작은 함수와 React context, `src/app/profile`의 테마 컴포넌트, `supabase/functions` 및 순차 SQL migration을 따른다. 예: `const result = await client.rpc('get_membership'); if (result.error) throw result.error;`. 새 BaaS나 결제 UI 의존성 없이 필요한 RevenueCat 네이티브 SDK만 추가한다.
- 순서: 검증 응답 파싱 테스트 → 서버 구독 상태/글 한도 연결 → 인증된 동기화·웹훅 → SDK 구매/복원·프로필 멤버십 화면 → 모임/대화 한도 → 스토어 및 기기 테스트. 각 단계에서 관련 검사 후 다음 단계를 진행한다.
- 검증 명령: `npm test`, `npm run typecheck`, `npm run lint`, `npx supabase test db`, `npx expo export --platform web`. 서버 테스트는 위조 권한·만료·샌드박스 분리·중복/역순 갱신·사용 한도 초과를 포함한다. 실제 스토어 결제 검증은 기기의 네이티브 빌드에서 별도 확인한다.
- 경계: 구매 결과는 서버가 RevenueCat 최신 고객 정보를 재조회해 확정한다. 클라이언트가 등급을 쓰지 못하고, 무료 이용과 기존 콘텐츠·안전 모니터링을 유지한다. 비밀 키를 앱·Git에 넣지 않는다. 가격 확정 전 실제 판매 상품 가격을 임의로 등록하지 않는다. 외부 자격 증명/정산이 미완료이면 구현 완료와 실결제 가능 상태를 구분한다.

- 결제: Apple StoreKit / Google Play Billing으로 인앱 디지털 혜택을 판매한다. Apple 기본 인프라를 먼저 검토했으며, Android와 글링 계정의 공통 권한까지 필요하므로 iCloud 전용 구독 상태 저장은 사용하지 않는다. 국가별 외부 결제 예외를 전제로 한 웹 결제는 초기 범위에 넣지 않는다.
- 관리 제안: RevenueCat으로 양 스토어 구매 검증·상태 관리를 묶고 기존 Supabase 사용자 ID에 연결한다. 자체 구현을 선택하면 같은 갱신·환불·만료 검증을 Store Server API로 직접 유지해야 한다. 실제 도입 시 비용과 Expo SDK 호환성을 재확인한다. 현재 RevenueCat 공개 가격은 월 추적 매출 USD 2,500까지 무료이며 기준 도달 후 추적 매출의 1%이고 스토어 수수료는 별도다.
- 등급: 서버에서 검증한 구독 등급과 작은 고정 한도표를 기존 글·모임·대화 RPC에 연결한다. `isPlus` 하나로 모든 유료 사용자를 표현하지 않으며, 결제 등급은 L1/L2 확인 등급·안전 권한과 분리한다. Apple에는 한 구독 그룹 안에 플러스/프리미엄과 각 기간 상품을 두어 등급 변경을 지원한다. Android도 상품 변경으로 처리하며 양 플랫폼을 가로지르는 중복 가입을 방지한다.
- 권한: 앱의 결제 성공 표시만으로 DB 권한을 쓰지 않는다. 인증된 웹훅, 이벤트 중복 처리, 최신 상태 재조회로 지연·역순 통지에 대응한다. 같은 글링 계정의 iOS/Android 혜택을 통합하고 다른 글링 계정으로의 구매 이전 규칙을 명시한다. 서버의 기존 작성 한도·잠금 패턴을 재사용하고 모임 승인 및 새 대화 생성도 동시 요청에서 한도를 넘지 않게 처리한다.
- 상태: 자동 갱신 해지는 통상 결제한 기간까지 유지, 만료·환불에 따른 권한 회수와 결제 유예는 검증된 공급자 상태를 따른다. 복원·구독 관리·계정 삭제 시 결제 관계를 테스트한다.
- 순서: 혜택/가격 확정 → 스토어 정산 및 테스트 상품 준비 → iOS 월 구독부터 실제 혜택까지 연결 → Android 같은 계정 연결 → 갱신/복원/해지/환불 검증 → 새 앱 버전과 구독 심사. 처음 자동 갱신 구독을 Apple에 제출할 때는 새 앱 버전과 함께 제출한다.
- 완료 기준: 양 스토어 테스트 결제가 실제 혜택에 연결되고, 취소/보류 결제·만료·중복 통지·다른 계정 접근 시 권한이 잘못 부여되지 않는다. 상세 순서와 검증은 `todo.md`의 같은 날짜 항목을 따른다.

근거: [Telegram 한도 확대와 무료·유료 회원 간 소통](https://telegram.org/faq_premium/?setln=en), [Discord 등급별 한도](https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More), [Apple 구독 그룹·등급](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/), [Apple 결제 정책](https://developer.apple.com/app-store/review/guidelines/#business), [Google 결제 정책](https://support.google.com/googleplay/android-developer/answer/9858738), [Expo 인앱 결제](https://docs.expo.dev/guides/in-app-purchases/), [RevenueCat Expo 통합](https://www.revenuecat.com/docs/getting-started/installation/expo), [RevenueCat 요금](https://www.revenuecat.com/pricing), [Google 서버 구매 검증](https://developer.android.com/google/play/billing/security), [Apple 첫 구독 제출](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase).


## 2026-09-09 마케팅 강의 전체 검토와 운영 개선

사용자 요청: 일부 핵심 요약이 아니라 6시간 강의 전체를 상세히 검토하고 우리 프로세스를 개선한다. 기존 부분 검토는 이 작업의 선행 자료다.

1. 전체 자막의 누락 구간을 정독하고 챕터별 화면·시연 결과를 확인한다. 완료 기준: 17개 챕터의 출처, 방법, 실패/수정, 적용 판단 기록과 자막 검토 범위 확인.
2. 기존 공통 playbook, 설치 스킬, 글링 원고·캘린더·출시 상태·Orca 자동화를 비교한다. 완료 기준: 실제 존재/누락/오래된 사실을 구분한 비교표.
3. 기존 문서에 실행 절차·완료 증거·실패 처리·측정 정의를 보강한다. 필요하면 작은 검증 도구만 추가한다. 완료 기준: 입력→초안→검증→예약/게시→관측→다음 변경이 연결되며 새 서비스·유료 구독이 없어도 한 회차를 준비할 수 있음.
4. 글링에서 외부 발행 없는 한 회차를 시험 실행하고 정상·중복·미수집·도착 링크 문제를 검증한다. 완료 기준: 실제 실행 산출물과 재실행 확인; 기술 확인을 마케팅 성과로 표현하지 않음.
5. 전체 분석과 변경 전후, 적용/보류 이유, 남은 외부 의존성을 보고하고 공통 지식에 환류한다.

의존: 1·2 조사 후 3→4→5. 다른 프로젝트는 읽기 참고만 하며 계정·예약은 변경하지 않는다. 계정 인증·공개 출시·실제 크레딧은 추정으로 완료하지 않는다. 사용자가 전체 분석과 개선 실행을 직접 요청했으므로 문서 변경·로컬 검증을 위한 추가 승인을 요구하지 않는다.

### 실행 점검의 범위와 합격 조건

기존 CSV를 유일한 게시 대기열로 유지한다. 변경되지 않는 content_id, 실험 ID, 실제 계정·예약·발행·관측 증거, 링크 위치를 보완한다. `python3 marketing/check_calendar.py`는 로컬 읽기 전용으로 중복 ID/원고, 글링 외 도착 링크, UTM-플랫폼 불일치, 미완성 변수, 근거 없는 완료/수치 표시를 거부한다. 프로필 공용 링크는 개별 글 유입으로 귀속하지 않는다. `python3 marketing/check_calendar.py --self-test`로 정상·중복·누락·잘못된 도착 경로·확인된 0을 검증한다. 표준 라이브러리만 사용하며 앱·DB·예약 API는 변경하지 않는다. 이 점검의 통과는 계정 생성이나 발행 성공의 증명이 아니다. 기존 사용자 요청 범위의 문서/캘린더/로컬 검증이며 외부 게시·결제는 발생시키지 않는다.

## 2026-09-10 홍보 크레딧 개발용 보관

최신 사용자 정정: 대화·모임 슬롯과 수락 규칙을 새 빌드에 반영한다. 캐시·글 끌어올리기만 숨긴다. `tasks/promotion-credits-spec.md`를 따른다.

- 기존 RevenueCat webhook 검증을 재사용하고 구매별 크레딧·홍보 배정을 같은 DB 트랜잭션에서 관리한다.
- 개발용 지갑/게시글 선택/홍보 시작/중단 UI를 만들되 Release에서는 메뉴·헤더·직접 경로 모두 비활성화한다.
- 구매·환불·중복 사용·접근 권한·기능 비활성 검증을 마친 뒤 개발 소스로 보관한다. 상품 등록·운영 마이그레이션·피드 송출 연결은 보류한다.
- 새 빌드를 검증·업로드한 뒤 기존 iOS 빌드 6 심사 제출을 교체한다. 구독 상품의 정산/심사와 Google 공개 출시 조건은 별도 확인한다.

## 2026-09-10 관계 슬롯 출시 빌드

[확정 정책](relationship-slots-and-promotion-2026-09-10.md)을 기존 conversations/messages와 모임 신청 테이블에 적용한다. 신규 서버·의존성은 추가하지 않는다. 대기/수락/종료 상태, 두 슬롯 풀, 서버 잠금 시각, 모임 공용 대화방만 추가한다.

1. 수락 전 메시지 금지와 양쪽 동시 슬롯 점검 → 최초 요청자만 24시간 잠금 → 모임 공용 대화 및 가입/나가기 → 기존 신고/차단/관리자/삭제 경로 검증.
2. 기존 B 컨셉 화면에 요청함·그룹/개인 필터·사용/잠금/가용 자리와 가까운 해제 시각을 표시. 개발용 홍보 진입점은 Release에서 비활성 유지.
3. DB 및 실제 두 연결 경쟁 검사, 단위/타입/lint, 브라우저와 네이티브 새 빌드 확인. 지원 기기에서 동작을 검증한 후 양 스토어 테스트 빌드 교체 및 iOS 재심사 제출.

완료 기준: 수락 전 접근 불가, 양쪽 중 한쪽 마지막 자리 경쟁에서 한 요청만 성공, 어느 쪽이 나가도 요청자만 잠금, 그룹 탈퇴자는 그룹 자리만 잠금, 승인된 그룹에서만 메시지/알림/신고 가능. 기존 직접 대화 기록은 보존하며 과거 미기록 요청자는 추정하지 않는다.

기본 종료 처리: 호스트 자발적 종료는 호스트만 잠금, 수동 강제 종료·계정 제재로 수동 참여자의 자리는 잠그지 않는다. 대기 요청 거절/취소에는 슬롯 잠금 없이 같은 쌍 재요청 24시간 간격, 요청 7일 만료와 스팸 방지 속도 제한을 적용한다. 이 제한은 하루 신규 대화 한도가 아니다.

롤백: 아직 심사 중인 빌드 6은 새 산출물 검증 전 철회하지 않는다. 새 상태/이력 테이블을 삭제하거나 동의 없는 이전 start_conversation 동작으로 되돌리지 않는다. 장애 시 요청/수락 시작을 일시 차단하고 기존 읽기·나가기·신고를 유지하는 서버 수정 후 재배포한다. 출시 시점 상태와 빌드 ID는 별도 완료 기록에 남긴다.

### 관계 슬롯 빌드 8 완료

`tasks/relationship-release-2026-09-10.md`에 최종 결과를 기록했다. 운영 0033 적용, DB 302개/JS 66개와 실제 경쟁·375px UI·iOS 시뮬레이터 로그인/슬롯 확인 통과. App Store 빌드 8은 심사 대기, TestFlight 내부 그룹과 Google 내부 테스트에 배포했다. 캐시/홍보 SQL은 deferred에 보관하고 운영에는 배포하지 않았다. 구현 커밋 6d61f8e의 웹 배포도 성공했다. 구독 실제 판매·Google 공개 출시·iPhone X 실기기 검증 조건은 별도 남아 있다.

## 2026-09-11 관리자 회원 식별·활동 보강

[스펙](../docs/specs/admin-user-investigation.md)의 순서로 관리자 RPC/DB 검사 → 회원 검색·상세 UI → 운영 적용·브라우저 검증을 진행한다. 기존 운영 자료와 다른 진행 작업을 보존한다.

관리자 회원 보강 완료: 운영 0035와 로컬 관리자 빌드 적용, DB 323개/Node 80개/타입/lint/공개 번들 분리 검사 및 Orca 실제 세션·375px 확인을 통과했다. 상세는 위 스펙의 완료 기록을 따른다.

추가 위치·IP 요청도 완료했다. 기존 인증 세션을 관리자 전용으로 조회하며 GPS·외부 위치 조회·신규 IP 추적 없이 등록 지역과 기록 시각을 구분한다. 운영 0036 및 DB 327개 검증 완료.

## 2026-09-11 Optional one-shot location
Follow docs/specs/one-shot-location.md: foreground GPS, nearby community choice, private consent/30-day records, audited admin history, disclosure and native verification.

Apple Design admin refinement and verification: `tasks/location-admin-2026-09-12.md`. Native GPS acceptance checks are tracked separately from backend/admin delivery.

## 2026-09-12 — Private member name and birth date

Follow `docs/specs/personal-info.md`: private storage and date/security checks → optional onboarding/settings entry and audited admin display → browser/build verification and additive deployment. No paid identity verification; no fabricated/backfilled personal data.
