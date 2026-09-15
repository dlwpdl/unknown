# 글링 네이티브 멤버십·광고 QA — 2026-09-12

담당: `term_d8f98589-67f3-4446-b997-bd8fa13d6987`. **최종 번들 `f71d82…`의 iOS 광고는 SDK 검증기 `No implementation issues found`, 네이티브 CGRectContainsRect 18/18 통과다. 기존 pending 1:1 요청에서도 미인증 상대 안전 안내를 직접 확인했다. 멤버십 가격·선택·Apple 로그인 진입은 통과했지만 실제 Sandbox 거래는 미검증이다.** 이전 `0875e7…` 번들의 CTA 약 0.3334pt 초과는 [LLDB 실측](native-ad-frames-2026-09-12.md)에 보존했고, marginBottom 1pt 수정 후 최종 결과는 마지막 절에 기록했다. 아래 설치본은 모두 해시로 구분한다. 마지막 App Store Connect 조회 기준 업로드된 TestFlight 11은 9월 11일 빌드로 이 로컬 변경을 포함하지 않는다. 앱 심사 승인이나 실결제 완료를 뜻하지 않는다. 광고·멤버십 구현은 별도 담당자의 [작업 기록](ads-membership-fix-2026-09-12.md)을 참고한다.

## 설치본과 증거 출처

1차 QA의 두 설치본 모두 앱 버전 1.0.0, 빌드 **11**이므로 빌드 번호만으로 최신 여부를 판단하면 안 된다. 아래 표의 ‘최신 설치본’은 당시 SDK 16.3.0 설치본을 가리킨다. 후속 16.3.4 설치본도 빌드 11이어서 별도 해시로 구분한다. 이 QA는 로컬 iOS 시뮬레이터이며 TestFlight나 물리 iPhone 검증이 아니다.

| 구분 | 기기·설치본 | 검증 시각 (PDT / UTC) |
| --- | --- | --- |
| 이전 설치본 | `4534DAFF-1461-4AB2-B021-18564574180C`, iPhone 16 Pro Max / iOS 26.5. 당시 앱 컨테이너 `8DF38D2F-54B6-4405-8A15-6D2F62D9B602/app.app`. 광고 SDK 반영 전, 비교표 수동 펼침 | 13:10–13:13 / 20:10–20:13 |
| 최신 설치본 | 전용 `583E7BFD-5CB4-42EC-B15C-1D4D5986FA39` (GLING Membership QA), iPhone 16 Pro Max / iOS 26.5. 컨테이너 `3A1B333E-9D74-4B97-80FA-55E29262CF92/app.app`. AdMob App ID 포함, 비교표 기본 펼침 | 13:22 / 20:22부터 |

최신 설치본은 광고 담당자가 제공한 최종 로컬 Release 빌드이며 이후 소스 커밋은 `9f2430f`다. 푸시·새 배포는 하지 않았다는 담당자 전달 사항이다. 이 QA에서 설치된 파일 자체를 확인한 SHA-256:

- `main.jsbundle`: `58ccc4cd6b8793a4ff3fd93a1c4e2209aee483a8a50523ecc5e78c1d5e010661`
- 앱 실행 파일: `ba0aa6431be8d4eeef361fb7a3e46e4ee78234e19e294856b7ec13764441782c`

## 직접 확인한 멤버십 결과

| 항목 | 이전 설치본 | 최신 설치본 |
| --- | --- | --- |
| 심사 계정 로그인·프로필→멤버십 진입 | 통과 (기존 로그인) | 통과 (새 설치에서 실제 로그인) |
| 무료 등급·하루 글 1편·모임/대화 각 3자리 | 통과 | 통과 |
| 비교표 기본 펼침 | 이전 동작: 수동 펼침 | 통과, 진입 직후 상품 표시 |
| StoreKit 상품 4개와 실제 가격 조회 | 통과, 네이티브 로그 `Received products response`, `Parsing 4 products` | 통과, 월/연 전환으로 4개 가격 직접 확인 |
| 월/연·Plus/Premium 선택에 따른 가격·구매 버튼·갱신 안내 갱신 | 통과 | 통과 |
| 네이티브 Apple 로그인창 진입 | 통과, Plus 연 구독 선택 | 통과, Plus 월 구독 선택 |
| 구매 중 중복 입력 방지 | 통과 | 통과, 상품/기간/구매/복원 버튼 비활성 |
| 거래 취소/실패 후 무료 등급 유지·버튼 재활성화 | 무료 유지 확인. 이전 설치본의 최종 버튼 재활성화는 미확인 | 통과. Sandbox 인증 실패가 SDK에서 취소로 전달됨. 무료 유지·상품/구매/복원 버튼 재활성 직접 확인 |
| 구매 완료→서버 검증→혜택 반영 | 미검증 | 미검증. Apple Sandbox 인증 단계에서 중단 |
| 구매 복원·갱신·해지·환불·등급 변경 | 미검증 | 미검증 |

조회 가격은 **미국 Storefront의 USD**다. 캐나다 기준 가격표와 통화를 혼동하지 않는다. 이전 네이티브 StoreKit 로그에서 `USA`, storefront `143441`, USD를 확인했다. 최신 설치본도 로그인 전 동일 가격을 표시했다.

| 상품 | 월 | 연 |
| --- | --- | --- |
| Plus | USD 6.99 | USD 69.99 |
| Premium | USD 9.99 | USD 99.99 |

앱은 RevenueCat의 실제 스토어 상품을 조회한다. Xcode scheme에 로컬 StoreKit 구성 파일이 연결되지 않았고 프로젝트에 `.storekit` 파일도 없다. 가격 캡처를 합성하거나 UI에 가격을 주입하지 않았다.

## 원본 화면 캡처

모두 `xcrun simctl io <해당 기기> screenshot`으로 캡처한 실제 네이티브 화면이며 이미지 편집·합성 없이 직접 열어 확인했다. 시각은 파일 생성 시각이다. 이전 설치본의 상태 표시줄 9:41은 실제 촬영 시각이 아니다.

| 원본 | 출처·PDT 시각 | 증명하는 내용 |
| --- | --- | --- |
| [monthly.png](../output/qa/membership-2026-09-12/monthly.png) | 이전, 13:12:05 | 월 가격·Premium 선택·구매 버튼·자동 갱신 안내 |
| [yearly-plus.png](../output/qa/membership-2026-09-12/yearly-plus.png) | 이전, 13:12:38 | 연 가격·Plus 선택·구매 버튼·자동 갱신 안내 |
| [apple-sign-in.png](../output/qa/membership-2026-09-12/apple-sign-in.png) | 이전, 13:13:05 | Apple 계정 로그인창까지 진입. 최종 구매 확인이나 구매 성공 증거는 아님 |
| [latest-entry.png](../output/qa/membership-2026-09-12/latest-entry.png) | 최신, 13:22:19 | 무료 혜택·24시간 잠금 상태·비교표 기본 펼침 |
| [latest-monthly.png](../output/qa/membership-2026-09-12/latest-monthly.png) | 최신, 13:22:39 | 실제 월 가격·Premium 선택·구매 버튼 |
| [latest-yearly-plus.png](../output/qa/membership-2026-09-12/latest-yearly-plus.png) | 최신, 13:22:51 | 실제 연 가격·Plus 선택·구매 버튼 |
| [latest-cancelled.png](../output/qa/membership-2026-09-12/latest-cancelled.png) | 최신, 13:24:48 | 인증 실패 후 구매 버튼 재활성. 취소 안내 문구는 화면 위로 스크롤돼 이 캡처에는 없음 |
| [latest-free-after-cancel.png](../output/qa/membership-2026-09-12/latest-free-after-cancel.png) | 최신, 13:26:47 | 재진입 후 무료 등급·혜택 유지와 취소 안내 |
| [latest-ios-test-ad.png](../output/qa/membership-2026-09-12/latest-ios-test-ad.png) | 최신, 13:25:41 | 테스트 광고 문구·버튼은 표시되지만 미디어 공백 |
| [latest-ios-test-ad-recheck.png](../output/qa/membership-2026-09-12/latest-ios-test-ad-recheck.png) | 최신, 13:26:16 | 35초 뒤 같은 광고 미디어 공백 지속 |

광고 담당자가 구독 4개 심사 스크린샷의 전달 상태 `COMPLETE`, 상품 모두 `READY_TO_SUBMIT`을 재조회하고 `2195300`에 기록했다고 전달했다. 이 QA에서 해당 커밋과 [심사 이미지 기록](../release/app-store/subscriptions/README.md)을 읽었으며, 등록한 `monthly-usd.png`/`yearly-usd.png`가 이전 원본 `monthly.png`/`yearly-plus.png`와 SHA-256까지 동일함을 검증했다. 최신 화면과 가격이 일치함도 직접 확인했다. 서버 상태 재조회·업로드는 광고 담당자의 검증이며 이 QA 담당자가 재조회하거나 심사를 제출한 것은 아니다. `READY_TO_SUBMIT`은 심사 승인이나 거래 성공을 뜻하지 않는다.

## 계정·테스트 환경

- Apple 비즈니스 화면에서 유료 계약·은행·미국 세금 양식·ITA 활성화를 직접 확인했다. 광고 담당자도 20:19 UTC 재조회로 확인했다. 초기 기록의 미완료 상태보다 이 결과가 최신이다. 양식의 모든 답변이 올바르다는 뜻은 아니다.
- 기존 Sandbox 테스터가 0명임을 확인한 뒤 무료 QA 계정 1개를 생성했다. App Store Connect 재조회로 생성 확인, 지역 CAN, 월 구독 갱신 간격 5분. 자격 증명은 저장소 밖의 접근 제한 파일에만 보관한다.
- 실제 유료 구매·유료 서비스 가입·출시·심사 제출은 실행하지 않았다. [Apple Sandbox 안내](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox)에 따라 최종 테스트 구매는 Sandbox 환경 확인 후에만 진행한다.
- 별도 광고 담당자의 86개 전체 검사·양 네이티브 빌드 통과 보고와 별개로, 이 QA에서 `node --experimental-strip-types --test scripts/membership-screen.test.mjs scripts/membership-refresh.test.mjs scripts/membership.test.mjs`의 **10/10 통과**를 직접 확인했다. 정적/단위 검사는 실제 스토어 거래의 대체 증거가 아니다.

## 1차 광고 QA — SDK 16.3.0

최신 iOS 피드에서 실제 `Test mode:` 광고를 직접 확인했다. 광고 표시·광고주·제목·본문·CTA는 렌더링됐고 앞뒤 게시글도 계속 표시됐다. 그러나 **미디어 영역은 큰 공백이며 아이콘·AdChoices도 캡처에서 보이지 않는다.** 35초 후 재캡처에서도 공백이 유지됐다. 따라서 텍스트 광고 로드만 통과이고 완전한 네이티브 광고 표시나 클릭 등록 정상은 확인되지 않았다. 광고·CTA를 클릭하지 않았다.

같은 실행 프로세스 `app[70885]`의 13:25:29 로그에 `icon`, `advertiser`, `headline`, `body`, `media`, `callToAction` 전체의 `Cannot find NativeAssetView` 오류가 기록됐다. 앞선 앱 실행 직후에도 같은 오류가 있었다. [필터링한 네이티브 로그](../output/qa/membership-2026-09-12/native-errors.txt)를 보관했다.

설치된 SDK 16.3.0의 `ios/RNGoogleMobileAds/RNGoogleMobileAdsNativeView.mm:129`를 읽어 오류 경로를 확인했다. `registerAsset`에서 `_bridge.uiManager viewForReactTag` 조회가 실패하면 미디어/CTA 등 네이티브 뷰 등록 전에 반환한다. Fabric/브리지 연결 경로가 조사 대상이라는 근거이며, 이 QA에서 원인 수정이나 수정 검증을 완료한 것은 아니다. 코드·의존성을 변경하지 않았다. Android 정식 Google Play 이미지의 표시 성공은 별도 담당자의 관찰이며 이 QA가 직접 재현한 결과는 아니다.

## Sandbox 거래 중단 근거와 남은 검증

13:23:46 PDT, 새 CAN Sandbox 테스터로 Apple 로그인 확인 버튼을 눌렀지만 구매 확인창 없이 앱으로 복귀했다. StoreKit은 `AMSErrorDomain Code=100` 인증 실패와 하위 `Code=2` 계정의 password reuse 불가를 기록했고, RevenueCat은 `Purchase was cancelled`로 전달했다. 실제 취소 버튼을 누른 이전 설치본 테스트와 구분한다. 최종 거래 승인 버튼을 누르지 않았고 구매 성공·유료 혜택을 관찰하지 못했다.

동일 오류에 대한 [Apple DTS 답변](https://developer.apple.com/forums/thread/768966)은 시뮬레이터의 Sandbox 상품 조회와 실제 기기 거래 테스트를 구분한다. 이번 관찰도 그 제한과 일치하지만 이 근거만으로 앱의 실제 기기 구매 성공을 추정하지 않는다. [RevenueCat 문서](https://www.revenuecat.com/docs/test-and-launch/sandbox/apple-app-store)도 로컬 StoreKit 구성 테스트와 기기 테스트를 구분하고 Sandbox의 통화/메타데이터 차이를 안내한다.

13:26 PDT `xcrun devicectl list devices`에서 등록된 두 iPhone 모두 `unavailable`이었다. 물리 iPhone에 테스트 빌드를 설치·조작할 수 없어 여기서 실제 거래 검증을 완료할 수 없었다. 다음 확인은 실제 기기의 Sandbox 또는 TestFlight에서 구매→RevenueCat 거래→서버 혜택 반영, 복원, 갱신/만료·해지·환불·등급 변경이다. 현 상태를 실제 구매 가능 또는 출시 준비 완료로 사용하면 안 된다.

마무리 재검증에서 관련 Node 검사 10/10, 보고서의 로컬 링크, 원본 PNG 10개(1320×2868), 최신 설치 파일 해시를 확인했다. QA용 Sandbox 브라우저 탭과 583E의 Orca 시뮬레이터 스트림을 종료했다. 기기 데이터와 설치본은 삭제하지 않았고 4534 기기는 조작하지 않았다. 애플리케이션 코드 수정·추가 커밋·푸시·배포는 하지 않았다.

## SDK 16.3.4 추가 QA 조율 이력

광고 담당자가 16.3.0의 bridgeless 뷰 등록 문제를 확인하고 공식 패치가 포함된 16.3.4로 의존성 변경·네이티브 재빌드를 진행한다고 전달했다. 이 시점에서는 새 설치본 경로·체크섬을 받기 전이므로 수정 완료로 판정하지 않는다. 위 광고 실패 결과는 16.3.0 설치본의 결과다.

583E 기기가 계속 `Booted` 상태이며 기존 앱·데이터가 보존돼 있음을 재확인했다. 요청에 따라 같은 기기를 유지한다. 새 `.app` 경로와 체크섬을 받으면 파일을 대조한 뒤 같은 기기에서 **미디어·AdChoices 표시 및 NativeAssetView 등록 오류 해소만** 추가 검증한다. 원본 캡처·빌드 해시·새 실행 구간 로그를 별도로 남기며, 이전 오류 로그를 새 설치본의 오류로 집계하지 않는다. 구독 구매·다른 기능 검사·중복 빌드는 추가하지 않는다.

## SDK 16.3.4 재검증 결과

같은 583E 기기에 `/tmp/gling-ads-simulator/Build/Products/Release-iphonesimulator/app.app`을 설치했다. 원본과 설치된 파일 각각에서 전달받은 SHA-256 두 개가 일치함을 확인했다. 앱 1.0.0 (11), 새 실행 시각 **13:37:10 PDT / 20:37:10 UTC**, 새 프로세스 **54251**이다. 기존 프로세스 70885는 설치 전에 종료했다. 설치된 컨테이너는 `7017EFA9-7511-474C-8D77-FD174A7F1AAE/app.app`이다.

- `main.jsbundle`: `c576ca5bf800ebaf1e94a26544588ae20156765bd68432bd083d3aa727e2d786`
- 앱 실행 파일: `30fedb8d12c43d3e63f7fd3b7240f475aa607c182f55e3cd073187ddc2a6c48e`
- 기기·경로·실행 시각·해시: [provenance.json](../output/qa/ads-sdk-16.3.4-2026-09-12/provenance.json)

| 요청 항목 | 직접 확인한 결과 |
| --- | --- |
| 미디어 표시 | **통과.** 테스트 광고 영상이 실제 렌더링·재생됐고 재생/음소거 UI와 재생 종료 후 썸네일이 보인다. 기존 공백 해소 |
| AdChoices 표시 | **통과.** 광고 우상단의 SDK 광고 정보 아이콘 표시를 원본 캡처에서 확인. 아이콘을 통한 외부 이동은 시험하지 않음 |
| NativeAssetView 등록 오류 | **관찰 구간 0건.** PID 54251의 13:37:10–13:40:49 PDT 로그 29,247개에서 `Cannot find NativeAssetView` 0건. 이전 PID 로그와 섞지 않음 |
| 별도 SDK 검증 경고 | **미해결 1건.** `Advertiser assets outside native ad view`. 자산 경계가 네이티브 광고 뷰 안에 있어야 한다는 상세 안내를 직접 열어 확인 |

화면·로그 증거:

- [ios-test-ad-visible.png](../output/qa/ads-sdk-16.3.4-2026-09-12/ios-test-ad-visible.png): 실제 영상 재생 장면. 광고 상단은 스크롤에 일부 가려져 있어 전체 광고 배치 증거로 사용하지 않는다.
- [ios-media-adchoices.png](../output/qa/ads-sdk-16.3.4-2026-09-12/ios-media-adchoices.png): 제목·본문·미디어·CTA와 우상단 AdChoices. SDK 경고 팝오버의 상세를 먼저 기록한 뒤 Dismiss로 닫고 캡처했다. 경고를 해결했다는 뜻은 아니다.
- [ios-test-ad-full.png](../output/qa/ads-sdk-16.3.4-2026-09-12/ios-test-ad-full.png): 광고와 SDK의 `1 implementation issue found` 팝오버.
- [native-ad-validator.png](../output/qa/ads-sdk-16.3.4-2026-09-12/native-ad-validator.png): `See issues`로 연 경계 경고 상세 원본.
- [registration-log-check.json](../output/qa/ads-sdk-16.3.4-2026-09-12/registration-log-check.json): 새 PID·조회 구간·전체 로그 개수·등록 오류 개수. SDK 화면의 경고는 시스템 로그에 없으므로 등록 오류 0건을 SDK 경고 0건으로 해석하지 않는다.

캡처는 모두 실제 시뮬레이터 원본 PNG이며 편집·합성하지 않았다. 광고주 CTA·AdChoices는 클릭하지 않았고 SDK 검증기의 `See issues`, 닫기, `Dismiss`만 조작했다. 16.3.4 Android 재검증 성공과 실기기 Release 빌드 성공은 별도 담당자의 보고이며 이 QA의 직접 검증에 포함하지 않는다.

## 프로필→설정 위치 카드 원본

광고 검증을 마친 뒤 동일 설치본·PID에서 **프로필 → 설정**으로 이동해 `NearbyCityCard` 전체가 보이도록 스크롤하고 원본 **1장**을 추가 캡처했다.

- [settings-nearby-city-card.png](../output/qa/ads-sdk-16.3.4-2026-09-12/settings-nearby-city-card.png)
- 상태: `내 도시에서 시작하기`, 위치 확인 실패 안내, `내 위치로 다시 추천`, `위치 공유 끄고 기록 삭제`가 표시됨. 기본 미동의 상태의 화면으로 취급하지 않는다.
- 위치 카드의 동의·다시 추천·공유 끄기·기록 삭제는 누르지 않았다. 다만 이 추가 캡처 요청이 오기 전, 새 앱 시작 때 나타난 iOS 위치 권한 팝업은 광고 QA를 위해 `허용 안 함`으로 닫았다. 따라서 현재 권한 거부/위치 확인 실패 상태도 화면 출처에 포함한다.
- 리디자인이나 소스 변경은 이 QA에서 하지 않았다. 583E와 현재 설치본·데이터·Orca 스트림을 유지한다.

후속 조율 당시 광고 담당자가 NativeAdView의 padding/border를 바깥 일반 View로 옮기는 경계 수정과 카테고리 위치의 Ad 표시·일반 글에 맞춘 제목/본문/여백을 함께 반영한다고 전달했다. 위 절은 `c576ca…` 번들 결과이며, 이후 전달받은 새 UI 번들의 실제 결과는 아래에 기록한다.

## 새 카드 UI·광고 경계 수정 번들 재검증

2026-09-12 **13:48:08 PDT / 20:48:08 UTC**에 기존 PID 54251을 종료하고 같은 583E에 새 Release 앱을 설치·실행했다. 새 PID **3919**, 설치 컨테이너 `D8628E13-C6BD-4F9F-BCB0-45B6A60FE653/app.app`이다. 원본과 설치된 파일에서 전달받은 두 SHA-256을 각각 대조했다. 버전은 여전히 1.0.0 (11), 번들 ID는 사용자 결정대로 `com.dlwpdl.gling`이다.

- `main.jsbundle`: `0875e7b41079fa3cc261d68ac993ab8a68656687ab8223765adebc4963b2510a`
- 앱 실행 파일: `30fedb8d12c43d3e63f7fd3b7240f475aa607c182f55e3cd073187ddc2a6c48e`
- [설치본·캡처 출처](../output/qa/ads-location-card-2026-09-12/provenance.json)

| 요청 항목 | 직접 확인한 결과 |
| --- | --- |
| 광고 상단 카테고리 자리 `Ad` | **통과.** 시각적으로 `Ad`, 접근성 이름은 `광고`. 일반 글과 같은 왼쪽 기준선·제목/본문 위계로 표시 |
| 광고주·CTA·미디어·AdChoices | **통과.** `loan.fairstone.ca`, `Apply Now`, 영상 썸네일과 재생 UI, 우상단 SDK 정보 아이콘 표시. 광고 클릭이나 재생 버튼의 수동 조작은 하지 않음 |
| 자산 경계 경고 해소 | **실패.** 새 프로세스에서 `1 implementation issue found`를 보고 `See issues`로 상세 확인. **`Advertiser assets outside native ad view`가 그대로 재현됨** |
| NativeAssetView 등록 오류 | **관찰 구간 0건.** 새 PID 3919의 13:48:08–13:49:40 PDT 전체 로그 15,462개에서 `Cannot find NativeAssetView` 0건. 경계 경고는 화면에서 확인했으며 로그에는 없음 |
| 설정의 짧은 위치 카드 | **통과.** `내 주변 소식`과 `GPS로 가까운 도시와 주변 동네를 찾아요.`로 축약. 상세 안내는 기본적으로 접힘 |
| 정보 아이콘 펼침·접힘 | **통과.** 아이콘만 눌러 안내 3문단 표시, 접근성 값 `expanded` 확인. 다시 누르면 안내가 사라지고 아이콘 복귀. 텍스트나 아래 버튼 겹침 없음 |

새 원본 PNG 5개는 모두 같은 설치본에서 `simctl screenshot`으로 촬영하고 직접 열어 확인했다. 이미지 편집·합성하지 않았다.

- [광고 전체와 검증 경고](../output/qa/ads-location-card-2026-09-12/ios-ad-card-validator.png)
- [경계 경고 상세](../output/qa/ads-location-card-2026-09-12/native-ad-validator.png)
- [광고와 다음 일반 글의 배치](../output/qa/ads-location-card-2026-09-12/ios-ad-card.png): SDK 팝오버를 Dismiss로 닫은 후 캡처. 경고 해결 증거로 사용하지 않는다.
- [위치 카드 기본 화면](../output/qa/ads-location-card-2026-09-12/settings-nearby-collapsed.png)
- [위치 카드 안내 펼침](../output/qa/ads-location-card-2026-09-12/settings-nearby-expanded.png)
- [새 PID 로그 집계](../output/qa/ads-location-card-2026-09-12/registration-log-check.json), [펼침 접근성 상태](../output/qa/ads-location-card-2026-09-12/nearby-expanded-ax.json), [다시 접은 접근성 상태](../output/qa/ads-location-card-2026-09-12/nearby-collapsed-ax.json)

위치 안내는 직접 저장한 지역의 우선 적용·미동의 시 수동 선택, 동의한 경우 로그인/작성 시점의 일회 확인·도시만 공개, 좌표/정확도/측정 시각 30일 보관·권한 관리자 조회·설정에서 철회/삭제를 포함한다. 이 재검증에서는 **위치 다시 확인, 공유 중단/삭제, 동의 변경, 실제 광고 CTA/AdChoices 클릭을 하지 않았다.** 이전 QA의 앱 동의 있음·OS 위치 권한 거부 상태를 유지했다. 새 실행에서는 이전의 일시적인 위치 실패 문구가 표시되지 않는다. 이 카드 QA는 GPS 측정이나 추천 도시의 정확성 검증이 아니다.

13:50:29 PDT에 App Store Connect를 직접 재조회했다. 최신 업로드는 빌드 **11**, `2026-09-11T14:45:37-07:00`, 상태 `VALID`다. [재조회 결과](../output/qa/ads-location-card-2026-09-12/app-store-builds.json). 같은 번호의 로컬 새 설치본과 혼동하지 않는다. 이번 변경은 아직 TestFlight에 업로드되지 않았다.

별도 담당자가 보고한 88/88·타입·린트·웹 export·iOS 양 빌드 통과는 이 QA의 직접 실행 결과와 구분한다. 이번에는 요청한 네이티브 표시·경고·펼침 동작만 직접 재검증했다. 애플리케이션 코드·결제·위치 데이터·심사 제출·업로드는 변경하지 않았다. 583E와 새 설치본·데이터·Orca 스트림을 유지하며 설정 카드는 접힌 상태로 남겼다.

## 최종 marginBottom 1pt·인증 UI 포함 설치본 — 통과

**14:01:34 PDT / 21:01:34 UTC** 같은 583E의 이전 PID 3919를 종료하고 새 Release 앱을 설치했다. 새 PID **74096**, 컨테이너 `C2A99210-3017-4BD4-81A3-7A72998645AC/app.app`, 버전 1.0.0 (11), bundle ID `com.dlwpdl.gling`이다. 원본과 설치된 파일 해시를 각각 대조하고 마지막에도 재확인했다.

- `main.jsbundle`: `f71d825198a5c1e8508ad226b9d5700d3b2d47514414a2a9e1fc4c0e989ad351`
- 실행 파일: `30fedb8d12c43d3e63f7fd3b7240f475aa607c182f55e3cd073187ddc2a6c48e`
- [최종 provenance](../output/qa/ads-final-2026-09-12/provenance.json): 설치 경로·PID·측정/캡처 시각·파일별 SHA-256·각 PNG의 원본 번들 해시. `before-install.png`만 이전 `0875e7…` 화면이다.

| 항목 | 직접 확인한 결과 |
| --- | --- |
| SDK 자산 경계 검증 | **통과.** 초록 체크와 `No implementation issues found`를 실제 화면과 AX에서 확인. 통과 화면 촬영 전에 Dismiss하거나 검증기를 끄지 않음 |
| 전체 등록 자산의 네이티브 CGRectContainsRect | **18/18 true.** GADNativeAdView 3개 × headline/body/icon/advertiser/callToAction/media 6개. UIKit 좌표 변환 결과에 실제 CoreGraphics 함수를 호출한 값이며, 호스트의 수식만으로 대체하지 않음 |
| CTA 하단 | `401.6666564941406pt` 유지. 화면 안 광고의 부모 높이는 `402.333251953125pt`로 **0.666595458984375pt 여유**. 이전 대비 부모 높이만 1pt 증가 |
| 다른 두 광고 | 부모 높이 `402.33349609375` / `402.3330078125pt`, CTA 하단 여유 `0.666839599609375` / `0.666351318359375pt`. 모든 자산이 실제 부모 descendant |
| 새 프로세스 등록 오류 | PID 74096, 14:01:34–14:03:22 PDT 로그 12,029개에서 `Cannot find NativeAssetView` 0건. 경계 경고 로그도 없음. 로그의 부재와 별도로 SDK 통과 화면을 확인 |
| 기존 대화의 안전 안내 | **pending 상태 직접 통과.** QA 계정에 이미 존재한 보낸 요청 1개를 열어 미인증 상대 안내와 공개 장소·개인정보·금전 요청 주의 문구를 확인 |
| active/ended 대화와 Lv2/Lv3 실화면 | **미검증.** 기존 계정 목록에 활성 대화는 없고 pending 요청 1개만 관찰했다. 새 대화·메시지·인증 단계 변경 없이 검사를 마침. 구현 코드 확인을 네이티브 상태별 검증으로 대체하지 않음 |

원본·진단 자료:

- [광고 전체와 SDK 통과](../output/qa/ads-final-2026-09-12/ad-full-validator-pass.png): Ad·제목·본문·미디어·광고주·CTA·AdChoices와 초록 통과 팝오버.
- [첫 SDK 통과 캡처](../output/qa/ads-final-2026-09-12/ad-validator-pass.png): 광고 상단 일부가 화면 밖에 있으므로 전체 배치 증거는 위 원본을 사용.
- [실제 자산 프레임 JSON](../output/qa/ads-final-2026-09-12/native-ad-frames.json), [LLDB 원본](../output/qa/ads-final-2026-09-12/lldb-frames-raw.txt), [조회 명령](../output/qa/ads-final-2026-09-12/snapshot.lldb).
- [SDK 통과 AX](../output/qa/ads-final-2026-09-12/ad-validator-ax.json), [새 PID 로그 요약](../output/qa/ads-final-2026-09-12/registration-log-check.json).
- [기존 pending 대화 안전 안내](../output/qa/ads-final-2026-09-12/existing-pending-chat-safety.png), [해당 AX](../output/qa/ads-final-2026-09-12/existing-pending-chat-ax.json). 본문 서버 메시지를 생성한 것이 아니라 요청 화면의 UI 안내다.
- [설치 직전 사용자 화면](../output/qa/ads-final-2026-09-12/before-install.png), [QA 후 복귀 화면](../output/qa/ads-final-2026-09-12/restored-city-picker.png).

진단은 이전과 같이 main thread에서 읽기 전용 getter·`convertRect:toView:`를 사용했다. 이번에는 변환된 숫자에 **네이티브 `CGRectContainsRect`를 직접 호출**해 JSON의 `cgrect_contains`에 저장했다. LLDB 분리 성공을 확인했다. 앱/SDK 소스·설정·위치 동의·데이터를 수정하지 않았다. 통과 캡처를 남긴 후 SDK 팝오버의 Dismiss만 눌러 채팅 탭으로 이동했다. 광고 CTA/AdChoices/미디어 재생, 대화 생성/수락/취소/종료/메시지 전송, 인증 등급 변경은 실행하지 않았다.

시작할 때 사용자가 도시 선택 화면을 열어둔 상태였으므로 원본을 남기고, QA 후 **도시 선택 화면·밴쿠버 선택 상태로 복귀**했다. 앱 데이터·로그인은 보존됐으며 같은 583E와 3100 스트림을 유지한다. 설치에 따른 재실행으로 가려진 피드의 이전 스크롤 위치까지 동일하다고 주장하지 않는다. 원본 PNG 5개 모두 1320×2868이며 편집하지 않았다. 이번 작업은 설치·네이티브 QA·기록만 수행했고 커밋·스테이징·업로드·출시는 하지 않았다.
