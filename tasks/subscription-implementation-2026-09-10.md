# 글링 구독 구현 현황 — 2026-09-10

기능 구현과 운영 서버 배포를 완료했다. 실제 유료 판매는 아직 열지 않았다. 기존 `tasks/plan.md`, `tasks/todo.md`의 구독 준비 단계 이후 상태는 이 문서를 따른다.

## 반영한 기능

| 항목 | 베이직 · 무료 | 플러스 | 프리미엄 |
| --- | ---: | ---: | ---: |
| 하루 글 작성 | 1편 | 2편 | 5편 |
| 현재 운영·참여 중인 모임 합계 | 3개 | 5개 | 10개 |
| 하루 새로 시작하는 1:1 상대 | 3명 | 5명 | 10명 |

- 무료 이용 유지. 프로필의 멤버십 화면, 현재 사용량, 프리미엄 우선 선택, 구매·복원·스토어 관리 경로를 추가했다. 기존 종이색·인주색과 다크 테마를 사용한다.
- 글과 새 대화는 도시 현지 날짜 기준이다. 기존 대화와 답장은 새 대화 한도에 포함하지 않는다. 이 집계 방식은 사용자 답변 전 안내한 구현 가정이며, 확정된 숫자와 구분한다.
- 모임 신청 대기는 자리를 점유하지 않는다. 승인할 때 한도를 다시 검사한다. 내 모임에서 나가기·신청 취소·운영 모임 종료를 제공한다. 종료된 글과 대화 이력은 보존한다.
- 권한과 한도는 서버에서 강제한다. 앱에서 등급을 보내거나 화면만 조작해 한도를 늘릴 수 없다. 동시 요청, 만료·해지·환불, 늦게 도착한 상태, 잘못된 공급자 응답을 처리한다.
- RevenueCat의 실제 스토어 가격만 표시한다. 상품이 없으면 준비 중이며 결제 버튼은 비활성화한다. 웹과 Expo Go에서 결제하지 않는다.
- 계정 삭제 전에 구독 관리 경로를 안내하고 RevenueCat 고객 정보 삭제도 요청한다. 스토어 자동 갱신은 계정 삭제와 별개다. 약관·개인정보·탈퇴 안내와 전용 문의 이메일을 갱신했다.

## 운영 연결

- Supabase `wjvahbdwmctzpkndqaxa`: 마이그레이션 `0028`–`0030`, `membership` 및 `delete-account` Edge Function 배포 완료.
- RevenueCat 프로젝트 `db748917`: App Store 앱 `appfaedf65971`에 글링 전용 Apple IAP 키 연결 완료.
- Entitlement `gling_plus`, `gling_premium` 생성 완료. 복원 정책은 **Keep with original App User ID**. SDK는 로그인한 글링 사용자 UUID만 사용한다.
- Webhook `Gling membership sync`: production/sandbox, 모든 이벤트 연결. 실제 테스트 전달 HTTP 200 확인. 서버의 sandbox 권한 허용은 지정한 심사 계정으로 제한한다.
- 서버 비밀키와 webhook 토큰은 Supabase secrets에만 설정했다. iOS·Android 공개 SDK 키는 무시되는 로컬 빌드 환경에 설정했다. 비밀 자료는 Git에 포함하지 않는다.

## 스토어 상품 및 판매 설정

2026-09-10 사용자 "그래 그렇게해"로 아래 월/연 가격을 확정했다. App Store에 4개 상품을 만들고 캐나다 가격을 저장·재조회해 일치함을 확인했다. Google Play의 2개 구독·4개 월/연 기본 요금제도 등록·활성화했고, API로 가격·기간·판매 국가를 재검증했다. 실제 스토어 구매 검증은 아직 완료하지 않았다.

| 등급 | 확정 월 구독 | 확정 연 구독 | RevenueCat package ID |
| --- | ---: | ---: | --- |
| 플러스 | CA$9.99 | CA$99.99 | `plus_monthly`, `plus_yearly` |
| 프리미엄 | CA$14.99 | CA$149.99 | `premium_monthly`, `premium_yearly` |

Apple 그룹 `22374585`(Gling Membership)에 프리미엄 레벨 1, 플러스 레벨 2로 월/연 상품을 묶었다. 판매 국가는 앱과 같은 CAN/KOR/USA이며 다른 통화 가격은 Apple 기준으로 환산했다. 한국어와 영어의 구독 그룹·상품 버전 설명도 등록했다.

| 상품 | App Store ID | Product ID |
| --- | --- | --- |
| 플러스 월간 | `6810726575` | `com.dlwpdl.gling.plus.monthly` |
| 플러스 연간 | `6810726662` | `com.dlwpdl.gling.plus.yearly` |
| 프리미엄 월간 | `6810726763` | `com.dlwpdl.gling.premium.monthly` |
| 프리미엄 연간 | `6810726825` | `com.dlwpdl.gling.premium.yearly` |

RevenueCat 현재 Offering은 `ofrng7b1ce64fd2`(`default`). Android 앱 `app6090b6749b`를 추가하고, 위 iOS 상품 4개와 Google 상품 `gling_plus:monthly/yearly`, `gling_premium:monthly/yearly`를 4개 package와 등급별 entitlement에 연결했다. Android 공개 SDK 키는 무시되는 로컬 빌드 환경에 저장했다. Google 실제 기본 요금제 4개도 모두 `ACTIVE`다. CA 가격은 확정 가격과 일치하고, 미국·한국 가격은 각 스토어 환산값을 사용한다. 별도 무료 체험·주간 구독·홍보 노출권은 만들지 않았다.

- Google Cloud `gling-app-dlwpdl`에 글링 전용 서비스 계정을 생성했다. Play 앱 권한은 `com.dlwpdl.gling`에만 부여했다. 읽기·재무 조회·주문/구독 관리·상품 관리 권한이며, 다른 앱과 프로덕션 출시 권한은 포함하지 않는다.
- Android Publisher, Developer Reporting, Pub/Sub API 활성화. RevenueCat Google 자격 증명 **Valid credentials** 확인.
- 실시간 알림 주제 `projects/gling-app-dlwpdl/topics/gling-revenuecat` 연결. Google 알림 발송 계정에는 이 주제의 Publisher 역할만 부여했다. Play Console에서 발송한 테스트를 RevenueCat에서 **2026-09-10 16:10 UTC 수신**으로 확인했다. 새로운 구매를 익명 고객으로 수집하는 옵션은 끈 상태다.
- Google 상품 API 검증: 플러스 월/연 `P1M`·`P1Y`, 프리미엄 월/연 `P1M`·`P1Y`, 모두 `ACTIVE`; 이용 가능한 국가는 각각 CA/KR/US 정확히 3개, CAD 가격 9.99/99.99/14.99/149.99 일치.
- Google 내부 테스트에 버전 코드 **7**을 업로드하고 출시했다. 콘솔에서 **내부 테스터에게 제공됨** 확인. 프로덕션 출시는 하지 않았다.

남은 작업:

1. Apple 유료 앱 계약은 `사용자 정보 대기 중`이다. 은행 계좌 추가와 미국 세금 설문지 등 본인의 정산·세금 정보 입력이 필요하다. Orca `Git → gling`의 App Store Connect 비즈니스 탭에 해당 화면을 열었다. 완료된 Google/RevenueCat 설정 탭은 닫고 이 입력 화면만 남겼다.
2. 양 스토어 sandbox에서 실제 구매·갱신·복원·해지·만료·환불·등급 변경을 검증한다. 자격 증명 및 알림 테스트는 실제 구매 검증을 대신하지 않는다. 현재 연결된 Android 기기/에뮬레이터는 없다.
3. Apple 구독은 아직 `MISSING_METADATA`다. 심사 스크린샷 등 메타데이터를 마무리하고, 구매 내역 처리에 맞춰 스토어 개인정보·데이터 보안 신고를 갱신한 다음 제출용 빌드를 올린다.
4. 내 글 홍보/노출권 상품은 별도 후속 범위다. 이번 구독에 포함하거나 혜택으로 판매하지 않는다.

## 검증

- `npm test`: 53/53 통과. 실제 계정 삭제 함수의 공급자 오류·재시도 및 구독 고객 삭제까지 포함.
- `npm run typecheck`, `npm run lint`: 통과.
- Supabase DB 테스트: 20개 파일, 217개 검사 통과. 무료·유료 글 한도, 모임 자리 반환·승인 재검사, 새 대화 일일 한도와 기존 대화 유지 검증.
- 운영 심사 계정의 `get_membership` 및 RevenueCat 서버 동기화 성공. 비인증 요청 401 확인.
- Orca 실제 웹에서 멤버십 표시·선택·접근성 상태와 내 모임/공개 모임 구분 확인.
- 최신 web export 성공: `/tmp/gling-subscription-web`.
- 구현 커밋 `48017f9`를 `dlwpdl/gling`의 `mobile-app`에 푸시했다. [GitHub Pages 배포](https://github.com/dlwpdl/gling/actions/runs/34450525417) 성공. 운영 도메인의 배포 JS에서 RevenueCat 개인정보 안내와 `gling@ej-entertainment.com` 반영을 확인했다.
- RevenueCat SDK 포함 iOS Release 빌드 성공. 연결된 iPhone X에 설치 완료. `idevicedebug --detach run com.dlwpdl.gling` 정상 종료로 실행 요청 완료. 실제 결제 동작은 상품 연결 후 검증해야 한다.
- 설치 바이너리: `/tmp/gling-subscription-device/Build/Products/Release-iphoneos/app.app`.
- Android `:app:bundleRelease` 성공. JDK 17·기존 Android SDK·업로드 키로 RevenueCat SDK와 Android 공개 키를 포함해 빌드했다. AAB: `android/app/build/outputs/bundle/release/app-release.aab`(76 MB). 병합 매니페스트의 `versionCode=7`, `com.android.vending.BILLING` 확인. `jarsigner -verify` 통과, 업로드 인증서 SHA-256 `413e75957cf604fd225a37527cce90b7379f3226b572f2b589c77396dcbfefbd` 일치. 새 prebuild에서 이전 APK 산출물은 정리됐다.

디자인 조사 근거: [구독 디자인 메모](subscription-design-2026-09-09.md).
