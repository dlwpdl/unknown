# 글링 광고·위치 카드 정리 — 2026-09-12

사용자 요청: 글링의 종이·인주 색과 글 중심 분위기를 유지한다. 광고는 일반 글의 카테고리 자리에 **Ad**를 표시한다. 위치 카드는 긴 설명을 줄이고 Apple 디자인 원칙을 적용한다.

## 확인한 근거와 적용

- [Apple Writing](https://developer.apple.com/design/human-interface-guidelines/writing?changes=l_1): 중요한 정보를 먼저, 짧고 동작이 분명한 문구를 쓴다. 위치 카드의 기본 화면을 `내 주변 소식`·GPS 안내 한 문장·주요 행동으로 줄였다.
- [Apple Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy?changes=_10_7): 위치가 필요한 기능을 사용하려 할 때 이유를 설명하고 권한을 요청한다. 첫 위치 버튼은 안내만 펼친다. 보관·관리자 조회·삭제 내용을 보여준 뒤 **동의하고 찾기**를 눌러야 권한 요청과 위치 확인을 시작한다.
- [Apple Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons?changes=latest_1__8): 버튼의 우선순위·누름 피드백·44pt 터치 영역을 유지한다. 정보 버튼은 펼침 상태와 이름을 접근성 API에 제공한다. 긴 글씨도 줄바꿈하며 고정 높이로 자르지 않는다.
- [Google 네이티브 광고](https://support.google.com/admob/answer/6239795?hl=en): 주변 콘텐츠의 시각 언어를 따르면서 광고임을 식별할 수 있어야 한다. 글링 PostCard와 같은 제목 18/26·본문 15/22·여백·종이 배경·얇은 구분선을 사용한다. 상단의 카테고리 위치에는 `Ad`, 아래에는 실제 광고주/아이콘과 SDK의 CTA를 표시한다.
- [Google 자산 배치 기준](https://support.google.com/admanager/answer/7031536?hl=en): Ad 표시는 상단에서 읽을 수 있게 유지하고 AdChoices 공간을 확보한다. 미디어 비율을 왜곡하거나 광고 제목·본문을 강제로 자르지 않는다. 빈 배경이나 가짜 반응 버튼에 광고 클릭을 연결하지 않는다.

연결된 디자인 도구도 확인했다. BrandKit에 Gling 항목이 없어 저장소의 `src/constants/theme.ts`와 PostCard를 기준으로 삼았다. Mobbin의 [Cash App 위치 안내](https://mobbin.com/screens/a83fa99d-5202-4250-898a-8ccb1745143d)를 직접 보며 짧은 이점 설명과 상세 정보 분리를 참고했다. Pinterest 검색은 보조 탐색으로만 사용했고 Kroma는 API 키가 없어 결과를 받지 못했다. Nextdoor 검색 결과는 광고임을 확인할 수 없는 뉴스 게시글이어서 광고 사례 근거로 사용하지 않았다.

## 원래 화면에서 확인한 문제

1. 같은 iOS 설치본의 프로필 → 설정 위치 카드를 [원본 캡처](../output/qa/ads-sdk-16.3.4-2026-09-12/settings-nearby-city-card.png)로 확인했다. 추천 설명·우선 지역·수집 시점·공개 범위가 한 카드에 계속 노출돼 정보가 빽빽했다. 캡처는 이미 공유 동의가 저장돼 있으나 기기 위치 권한은 거부된 상태다.
2. 광고 SDK 16.3.0은 iOS bridgeless 자산 등록 오류로 미디어가 비었다. 16.3.4에서 미디어·AdChoices·등록 오류 해소를 확인했다.
3. 그 다음 Google 검증기가 `Advertiser assets outside native ad view`를 발견했다. NativeAdView의 장식·여백을 바깥 View로 옮겨도 경고가 남았다. LLDB로 실제 네이티브 뷰를 측정하니 CTA 하단은 401.6667pt, 부모 높이는 401.3330pt로 약 1/3pt 초과했다. 나머지 등록 자산은 경계 안이었다. [SDK 이슈 #700](https://github.com/invertase/react-native-google-mobile-ads/issues/700)의 소수점 높이 재현과 일치한다. 내부 마지막 행에 아래 여백 1pt를 추가해 반올림 오차를 흡수한다. 고정 높이나 SDK 검증기 비활성화는 사용하지 않는다. 수정 후 같은 시뮬레이터의 광고 3개 × 자산 6개 전부 `CGRectContainsRect = true`, CTA 하단 여유 약 0.667pt를 확인했다. Google 검증기도 **No implementation issues found**로 통과했다.

## 변경 범위

- 광고: 카테고리 `Ad`, 일반 글과 같은 문단·타이포·구분선, 실제 광고주·아이콘·CTA. 광고 빈도와 테스트 광고 기본값은 기존 수정 기록을 따른다.
- 위치: 짧은 기본 카드, 정보 아이콘으로 상세 안내 펼침, 첫 공유 전 명시적 동의, 피드의 `직접 선택` 버튼은 기존 도시 선택 화면으로 연결. 가입·작성 화면은 바로 옆의 기존 도시 선택을 사용한다.
- 위치의 수집 시점·보관 기간·권한 있는 관리자 조회·삭제·선호 지역 우선 로직은 유지한다. 서버나 DB 변경은 없다.

## 검증

- 타입·린트·전체 Node **89/89**, 공개 웹 export 및 관리자 화면 제외 검사 통과.
- iOS 실기기 대상/시뮬레이터 Release, Android 서명 APK/AAB 빌드 통과.
- 새 회귀 검사 `node --experimental-strip-types --test scripts/feed-cards.test.mjs`: 안내를 펼치기만 해서는 위치를 수집하지 않음, 별도 동의 후 수집, 수동 선택, 저장 지역 자동 변경 방지, 광고 표시와 자산 경계 확인.
- 최종 UI를 양 플랫폼에서 확인했다. iOS 원본 [광고·검증기 통과](../output/qa/ads-final-2026-09-12/ad-full-validator-pass.png), [접힌 위치 카드](../output/qa/ads-location-card-2026-09-12/settings-nearby-collapsed.png), [펼친 위치 안내](../output/qa/ads-location-card-2026-09-12/settings-nearby-expanded.png)를 검토했다. Android 최종 APK의 원본 캡처는 비공개 `~/Library/Application Support/gling/operations/ads-android-final-ui-2026-09-12.png`다. 광고 클릭·설치를 실행하지 않았으며 변경 소스를 배포하지 않았다.

광고 계정·스토어 상품·구매 검증의 범위와 남은 운영 조건은 [광고·멤버십 수정 기록](ads-membership-fix-2026-09-12.md)을 따른다.
