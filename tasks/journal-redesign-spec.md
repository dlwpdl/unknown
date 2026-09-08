# 글링 B안: 동네 저널

## 승인과 목표
사용자는 2026-09-07 A/B 시안 리포트의 B안을 선택하고 실제 반영을 승인했다.
사진과 모임은 B의 분위기를 살리고 사진 없는 질문은 A처럼 읽기 쉽게 보여준다.
기존 `output/design/gling-redesign/index.html`과 PDF가 승인된 시각 기준이다.
BrandKit 기본 템플릿 대신 저장소의 글링 색·로고를 사용한 기존 Mobbin/Pinterest 조사와 apple-design 원칙을 이어 적용한다.

## 범위와 성공 조건
- iOS/Android 오늘 피드: 기존 로고, 도시 선택·검색·알림, 날짜와 큰 제목, 한 줄의 9개 카테고리.
- 현재 첫 페이지에서 사진 글 1개와 모임 최대 2개를 먼저 보여준다. 모든 글은 한 번만 표시하며 나머지 순서와 서버 페이지 cursor를 보존한다. 다음 페이지 글을 상단으로 끌어올리지 않는다.
- 사진은 실제 게시글 사진만 사용한다. 사진이 없거나 로드에 실패하면 텍스트를 읽을 수 있어야 한다. 모임 일정 데이터가 없으므로 예시 날짜를 만들지 않는다.
- 인기 해시태그는 기존 검색 화면에서 계속 제공한다. 비어 있는 카테고리에는 안내를 표시한다.
- 도시 선택은 네이티브 시트에서 현재 선택과 운영 상태를 구분한다. 닫기, 시스템 뒤로가기와 iOS 스와이프 닫기를 제공한다.
- 글쓰기 횟수는 탭 배지 대신 작성 화면에서 실제 quota로 안내한다. 네 개의 탭과 로그인 게이트를 유지한다.
- 공유 PostCard의 상세·검색·프로필 호출, 반응 롤백, 신고·차단·신뢰 표시·모임 참여를 보존한다.
- 시스템 글자 확대·다크 모드, 44pt 조작 영역, 안전 영역을 확인한다. 직접 만든 물리 애니메이션 대신 플랫폼 시트를 재사용한다.

## 기술과 구조
Expo 57 / React Native 0.86 / React 19.2.3. 기존 expo-image, expo-symbols, NativeTabs, Modal과 테마만 사용한다.
`src/app/index.tsx`는 피드와 시트, `src/components/post-card.tsx`는 공유 카드,
`src/lib/feed-data.ts`는 데이터 배치, `src/i18n/ko.ts`는 문구, `scripts/feed-data.test.mjs`는 순서 회귀 검증을 담당한다.
기존처럼 named export, 단일 인용부호, StyleSheet와 useTheme을 사용한다.

## 검증 명령과 순서
1. `node --experimental-strip-types --test scripts/feed-data.test.mjs`: 사진 없음·빈 목록·중복·모임 상한·페이지 추가 순서 테스트를 먼저 실패시킨 뒤 구현한다.
2. `npm test`, `npm run typecheck`, `npm run lint`: 기존 기능과 새 데이터 배치를 확인한다.
3. `npx expo export --platform android --output-dir /tmp/gling-journal-android`: Android 번들 확인.
4. `xcodebuild -workspace ios/gling.xcworkspace -scheme gling -configuration Release -sdk iphonesimulator -derivedDataPath /tmp/gling-derived-release CODE_SIGNING_ALLOWED=NO build`: 기존 캐시로 iOS 앱 빌드.
5. 별도 iPhone 시뮬레이터에서 실제 피드·도시 선택·검색·로그인 진입, 다크 모드와 큰 글자를 확인하고 로컬 화면 증거를 남긴다.

## 경계
항상: 기존 권한 검사와 ADR-0001의 모든 콘텐츠 안전 분석 범위 유지, 실제 데이터와 예시 구분, 검증 후 저장.
범위 확장 시 확인: 새 서버·의존성·데이터베이스 스키마·스토어 제출.
하지 않음: 새 저장소 생성, 자격 증명 커밋, 사진·일정·운영 데이터 조작, 승인되지 않은 출시.

## 실행 순서
피드 배치 회귀 검사 → 피드/도시/작성 안내와 공유 카드 병렬 구현 → 빌드·실제 화면 검증 → 기존 레포에 변경 저장.

## 검증 결과 — 2026-09-07
- 회귀 검사를 먼저 실패시킨 뒤 구현했다. 최종 `npm test` 38/38, 타입 검사, 린트, `git diff --check` 통과.
- Android Hermes 번들 내보내기와 iOS Release 시뮬레이터 빌드 성공. 새 의존성·네이티브 설정 변경 없음.
- iPhone 17 Pro / iOS 26.5에서 현재 피드, 밴쿠버→토론토 전환과 시트 닫기, 검색어 `영화`의 실제 결과 표시, 모임 참여 시 로그인 안내 진입을 확인했다. 다크 모드와 `accessibility-medium` 글자 크기에서 제목·모임·도시 목록이 겹치지 않았다.
- 별도 임시 체크아웃에서만 예시 사진을 연결해 카드 렌더링, 이미지 실패 후 텍스트 표시, 새 URI 재시도, 긴 해시태그 줄바꿈, 빈 카테고리와 준비 중 도시 안내를 확인했다. 운영 게시글과 이미지는 수정하지 않았다.
- Android는 번들 검증까지 수행했다. 실제 기기 실행과 로그인 후 게시·반응·참여의 서버 작업은 이번 시각 검증에 포함하지 않았다.
- 시트의 닫기 버튼과 도시 선택에 따른 닫힘은 확인했다. iOS 스와이프는 네이티브 `allowSwipeDismissal`을 사용하지만 자동 드래그로는 닫힘을 확인하지 못했으므로 기기에서 제스처 확인이 남아 있다.

화면 증거: [iOS 오늘](../output/design/gling-redesign/implemented/ios-home.png), [도시 시트](../output/design/gling-redesign/implemented/ios-city-sheet.png), [큰 글자·다크 모드](../output/design/gling-redesign/implemented/ios-large-dark.png), [도시 큰 글자](../output/design/gling-redesign/implemented/ios-city-large-dark.png), [별도 예시 사진](../output/design/gling-redesign/implemented/photo-fixture-web.png), [사진 실패·긴 해시태그](../output/design/gling-redesign/implemented/photo-fallback-web.png).
