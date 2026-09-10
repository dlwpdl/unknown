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
- 서버 비밀키와 webhook 토큰은 Supabase secrets에만 설정했다. iOS 공개 SDK 키는 무시되는 로컬 빌드 환경에 설정했다. 비밀 자료는 Git에 포함하지 않는다.

## 남은 판매 설정

가격·구독 주기는 아직 사용자 확정 전이다. 아래는 검토용 제안이며 등록된 판매 가격이 아니다.

| 등급 | 월 구독 제안 | 연 구독 제안 | RevenueCat package ID |
| --- | ---: | ---: | --- |
| 플러스 | CA$9.99 | CA$99.99 | `plus_monthly`, `plus_yearly` |
| 프리미엄 | CA$14.99 | CA$149.99 | `premium_monthly`, `premium_yearly` |

1. App Store Connect의 유료 앱 계약이 아직 `신규` 상태다. 계약자 확인·동의와 이후 은행/세금 정보 등록을 완료해야 한다. 글링 폴더의 App Store Connect 탭에 계약 검토 화면을 열어뒀다. 가격 확정 후 Apple 구독 그룹·상품, Google 구독·기본 요금제를 등록하고 RevenueCat 상품과 현재 Offering에 위 package ID로 연결한다. Apple 그룹은 프리미엄이 상위 등급이며 기간만 다른 상품은 같은 등급으로 둔다.
2. Google Play 판매자 결제 프로필을 연결한다. 현재 계정에는 미국·한국·캐나다 기존 프로필이 보이며, 수익 수령 국가·프로필 선택을 사용자에게 확인해야 한다. Orca의 `Git → gling` 안 결제 프로필 탭에 선택 화면을 열어뒀다.
3. Google Play 서비스 계정 연결과 RevenueCat Android 앱·공개 SDK 키 설정을 완료한다. 현재 Android 키가 없어 Android 결제는 준비 중이다.
4. 양 스토어 sandbox에서 실제 구매, 갱신, 복원, 해지·만료·환불과 등급 변경을 검증한 다음 스토어 제출용 빌드를 올린다. Webhook 테스트와 DB 테스트는 실제 구매 검증을 대신하지 않는다.
5. 내 글 홍보/노출권 상품은 별도 후속 범위다. 이번 구독에 포함하거나 혜택으로 판매하지 않는다.

## 검증

- `npm test`: 53/53 통과. 실제 계정 삭제 함수의 공급자 오류·재시도 및 구독 고객 삭제까지 포함.
- `npm run typecheck`, `npm run lint`: 통과.
- Supabase DB 테스트: 20개 파일, 217개 검사 통과. 무료·유료 글 한도, 모임 자리 반환·승인 재검사, 새 대화 일일 한도와 기존 대화 유지 검증.
- 운영 심사 계정의 `get_membership` 및 RevenueCat 서버 동기화 성공. 비인증 요청 401 확인.
- Orca 실제 웹에서 멤버십 표시·선택·접근성 상태와 내 모임/공개 모임 구분 확인.
- 최신 web export 성공: `/tmp/gling-subscription-web`.
- RevenueCat SDK 포함 iOS Release 빌드 성공. 연결된 iPhone X에 설치 완료. `idevicedebug --detach run com.dlwpdl.gling` 정상 종료로 실행 요청 완료. 실제 결제 동작은 상품 연결 후 검증해야 한다.
- 설치 바이너리: `/tmp/gling-subscription-device/Build/Products/Release-iphoneos/app.app`.

디자인 조사 근거: [구독 디자인 메모](subscription-design-2026-09-09.md).
