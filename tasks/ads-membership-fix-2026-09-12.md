# 광고·멤버십 수정 — 2026-09-12

코드와 양 플랫폼 Release 빌드를 수정·검증했다. 실제 스토어 구매 및 실광고 송출 완료를 뜻하지 않는다. 이번 빌드는 배포하지 않았다.

## 앱 수정

- 광고는 AdMob 등록만 있었고 앱 SDK·노출 위치가 없었다. 기존 피드에 네이티브 광고를 연결했다. 일반 글 5개 뒤부터 10개 간격이며 모임 피드·웹·Expo Go에는 표시하지 않는다. 광고 표시·AdChoices 공간·이미지 비율·SDK 클릭 처리를 유지하고, 로드 실패 시 피드를 계속 사용할 수 있다.
- `react-native-google-mobile-ads`를 Expo 57 기본 Kotlin 구성과 함께 빌드되는 **16.3.0**으로 고정했다. Android Google Mobile Ads 25.0.0 / UMP 4.0.0, iOS 13.1.0 / UMP 3.1.0이다. 16.5.0의 Kotlin 메타데이터 충돌 때문에 버전을 조정했으며 Kotlin 강제 업그레이드나 별도 빌드 플러그인은 남기지 않았다.
- 기본값은 Release도 Google 테스트 광고다. `EXPO_PUBLIC_ADS_MODE=live`일 때만 실제 광고 단위를 사용하고 UMP의 광고 요청 가능 여부를 먼저 확인한다. 개인 맞춤 광고를 요청하지 않으며 설정에서 개인정보 선택을 변경하면 기존 광고도 해제한다. 광고 SDK에 회원 이름·생년월일·GPS 좌표·게시글·대화를 전달하지 않는다.
- 멤버십 비교·가격·구매 버튼을 처음부터 펼쳐 보인다. 스토어 상품이 없을 때 원인을 안내한다. 실제 스토어 가격, 계정별 구매·복원 및 서버 검증 조건은 유지한다.
- 개인정보처리방침에 SDK가 처리하는 광고 정보와 설정 경로를 반영했다. 웹 공개 문서 배포와 스토어 데이터 신고는 새 릴리스에 반영해야 한다.

## 운영 설정 확인·복구

- RevenueCat iOS·Android 공개 키가 로컬 빌드 키와 일치하고, 현재 offering의 월/연 4개 패키지가 각 스토어 상품에 연결된 것을 재조회했다. 운영 심사 계정의 멤버십 동기화 HTTP 200을 확인했다.
- Google Play `gling_plus`, `gling_premium`의 월/연 4개 기본 요금제는 모두 `ACTIVE`, 기간 P1M/P1Y, 판매 CA/KR/US다. CAD 9.99 / 99.99 / 14.99 / 149.99를 재확인했다.
- Apple은 캐나다 가격만 저장되어 있었다. 확정된 CAD 가격을 기준으로 **각 상품의 전체 175개 국가 환산 가격표**를 복구하고 재조회했다. 판매 지역은 CAN/KOR/USA 그대로다. 3개 판매 국가에만 가격을 추가한 초기 수정으로는 전체 가격표 누락을 해결하지 못해 `subscriptions setup --repair`로 마무리했다.
- Apple 월/연 4개 상품의 한국어·영어 설명 8개를 현재 모임·대화 자리 및 24시간 잠금 규칙으로 수정했다. 심사 스크린샷이 4개 모두 없음을 확인해 실제 iOS 멤버십 캡처를 등록했고, 모든 이미지의 전달 상태 `COMPLETE`와 모든 상품의 **`READY_TO_SUBMIT`** 전환을 재조회했다. 최종 검증은 오류 0·차단 0이며, 선택 사항인 프로모션 이미지 및 심사 제출 전 상태에 대한 경고만 남았다.
- AdMob 계정은 승인 상태이고 글링 iOS·Android 앱은 모두 `Requires review`, 공개 스토어 연결 없음이다. 운영 `app-ads.txt`의 게시자 ID는 일치한다.
- 글링 두 앱 전용 유럽 동의 메시지 `Gling European consent`와 미국 개인정보 선택 메시지(2026-09-12 생성, 콘솔 이름 `Untitled US states message`)를 게시했다. 각 메시지가 글링 두 앱에만 연결된 것을 확인했다. 기존 Rottery 메시지는 유지했다. 개인정보 URL은 `https://gling.ej-entertainment.com/privacy`다.
- 변경 응답 기록은 비공개 `~/Library/Application Support/gling/operations/subscription-*-repaired-2026-09-12.json`에 저장했다. 자격 증명은 커밋하지 않는다.

## 검증

- `npm run typecheck`, `npm run lint`, `npm test`: 통과, Node **86/86**. 빈 상품 목록 회귀 검사는 수정 전 실패·수정 후 통과를 확인했다. 광고 위치, 플랫폼, 테스트 광고 기본값, 동의 전 초기화 차단, 중복 초기화, 선택 변경 후 해제도 검사한다.
- 웹 export 및 `node scripts/check-public-web.mjs /tmp/gling-ads-web`: 통과. 웹에 네이티브 광고 SDK나 관리자 화면을 포함하지 않는다.
- iOS 실제 기기 대상 Release 빌드 및 `codesign --verify --deep --strict`: 통과. `/tmp/gling-ads-device/Build/Products/Release-iphoneos/app.app`, 빌드 11, iOS AdMob App ID·측정 초기화 지연 설정 확인.
- Android `:app:bundleRelease :app:assembleRelease`: 통과. `android/app/build/outputs/{apk,bundle}/release/`에 APK/AAB 생성. APK 서명 SHA-256 `413e75957cf604fd225a37527cce90b7379f3226b572f2b589c77396dcbfefbd` 일치.
- iOS·Android 최종 번들 안에 각각 올바른 RevenueCat 공개 키가 들어 있는 것도 확인했다. 키 값은 출력하지 않았다.
- Android 정식 Google Play API 36 이미지에 같은 APK를 설치해 **실제 피드의 Google 테스트 광고 제목·본문·이미지·설치 버튼 표시**를 확인했다. 클릭·설치는 실행하지 않았다. 비공개 실제 캡처: `~/Library/Application Support/gling/operations/ads-android-2026-09-12.png`.
- 초기 Google APIs 에뮬레이터에서는 `Incorrect native ad response. Click actions were not properly specified`로 실패했다. 해당 이미지의 기본 Play Store 모듈이 `market://` 링크를 처리하지 못했다. 정식 Play 이미지에서 정상 표시되어 추가 앱 변경은 하지 않았다. 테스트용 AVD `Gling_Ads_Play_API_36`를 남겼고 Android 에뮬레이터 프로세스는 종료했다.
- iOS 시뮬레이터 Release 빌드도 통과했고 광고가 로드되어 접근성 트리에 포함되는 것을 확인했다. 화면 캡처 중 다른 글링 QA 세션과 Orca 시뮬레이터 제어가 겹쳐 기기가 종료됐다. 이를 광고 표시 완료로 기록하지 않는다. 다른 QA 세션은 유지하고 제 시뮬레이터 조작을 중단했다.
- 별도 글링 QA가 같은 광고 포함 설치본을 `GLING Membership QA` 시뮬레이터에서 재검증했다. `latest-monthly.png`·`latest-yearly-plus.png`를 직접 검토해 4개 실제 USD 가격과 월/연 선택을 확인했다. Apple 구매 로그인창 진입 후 Sandbox 인증 실패로 취소 안내에 돌아왔고 무료 등급·버튼 상태를 유지했다는 QA 결과를 받았다. 구매 완료·복원·유료 혜택 반영 성공으로 기록하지 않는다. 상세 설치본 출처와 후속 결과는 별도 `tasks/membership-native-qa-2026-09-12.md` 기록을 따른다.

## 남은 실제 운영 조건

1. Apple 계약·정산 장애는 작업 중 해소됐다. 초기에는 유료 계약이 사용자 정보 대기 중, 은행 처리 중, 미국 세금 정보 없음이었으나 **2026-09-12 최종 비즈니스 화면 재조회에서 유료 계약·은행·미국 증명/W-8BEN·캐나다 GST/HST·ITA 모두 활성**을 직접 확인했다. 별도 글링 작업에서 처리된 변경으로, 이 작업에서 세금 답변이나 계좌 정보를 입력한 것은 아니다. 초기 미완료 안내보다 이 재조회 결과가 우선한다.
2. Apple 구독 심사 이미지는 등록 완료했다. 원본과 설치본 구분은 [구독 심사 화면 기록](../release/app-store/subscriptions/README.md)에 있다. 네 상품을 제출용 앱 버전에 연결하고 심사를 제출하는 단계는 아직 실행하지 않았다.
3. 공개 스토어 연결·AdMob 앱 검토, 이용 연령 확정에 맞춘 동의 설정과 양 스토어 데이터 신고 후 실광고 모드로 전환한다. 기존 13세 미만 대상 아님 방침을 18세 이상으로 바꾸지 않았다.
4. 새로운 TestFlight·Google Play 테스트 설치본에서 상품 조회·구매·복원·갱신·해지·환불·등급 변경 및 서버 혜택 반영을 검증해야 한다. 실제 결제나 스토어 출시를 실행하지 않았다.

근거: [Expo 57](https://docs.expo.dev/versions/v57.0.0/), [네이티브 광고 SDK](https://docs.page/invertase/react-native-google-mobile-ads/native-ads), [UMP 동의 처리](https://docs.page/invertase/react-native-google-mobile-ads/european-user-consent), [Apple 구독 가격](https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-pricing-for-auto-renewable-subscriptions), [RevenueCat 상품 조회 점검](https://www.revenuecat.com/docs/offerings/troubleshooting-offerings).
