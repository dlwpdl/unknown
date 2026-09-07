# 글링 — App Store 메타데이터 (ko-KR)

작성: 2026-09-06. [App Store Connect 앱 6809273242](https://appstoreconnect.apple.com/apps/6809273242/distribution/ios/version/inflight)에 이름·부제·카테고리·설명·프로모션·키워드·지원/마케팅/개인정보 URL과 버전 1.0.0을 저장했습니다. 수동 출시로 설정한 제출 준비 초안이며 심사에 제출하지 않았습니다. 개인정보 설문, 연령 등급과 아래 심사 메모는 아직 문서 초안입니다. [출시 상태](release-status-2026-09-06.md)의 필수 항목을 완료한 뒤 제출합니다.

2026-09-07: 같은 문구의 [CLI용 JSON과 검증·인증 상태](../release/app-store/README.md#app-store-connect-cli-500)를 준비했습니다. 문구를 변경할 때는 해당 JSON도 함께 갱신합니다.

## 앱 정보

- 이름: `글링 - 캐나다 한인 커뮤니티`
- 브랜드는 `글링`으로 확정. App Store Connect에서 `글링` 단독 이름 저장은 이미 사용 중이라는 오류로 거절되어 위 등록명을 유지한다. 홈 화면 표시명은 `app.json`에서 `글링`으로 설정했고 다음 네이티브 빌드부터 적용된다.
- 부제: `밴쿠버·토론토의 일상과 동네 이야기`
- 기본 언어: 한국어
- 기본 카테고리: 소셜 네트워킹
- 보조 카테고리: 라이프스타일
- Bundle ID: `com.dlwpdl.gling`
- 버전 / 빌드: `1.0.0` / `1` (App Store Connect 업로드 성공; 다음 업로드는 빌드 번호 증가)
- Apple Team: `P3X3452TDZ`
- 개인정보처리방침 URL: `https://dlwpdl.github.io/gling/privacy`
- 지원 URL: `https://dlwpdl.github.io/gling` (하단 운영자 이메일)
- 마케팅 URL: `https://dlwpdl.github.io/gling`
- 개인정보 선택 / 계정 삭제 URL: `https://dlwpdl.github.io/gling/account-deletion`
- 현재 앱·정책의 고객지원 이메일: `gling@ej-entertainment.com`
- 저작권: `2026 Eunsense Studio` — Rottery의 기존 등록 정보를 확인하고 2026-09-07에 글링에도 저장.
- 키워드: `교민,유학,이민,정착,생활,맛집,모임` — 이름·부제에 있는 중복 단어는 CLI 검사 결과에 따라 제거.

## 프로모션 텍스트

캐나다의 오늘을 한국어로 나누세요. 밴쿠버와 토론토의 일상, 정착 정보, 맛집과 모임을 한곳에서 만나고, 댓글과 대화로 가까운 이웃과 연결됩니다.

## 설명

캐나다 생활, 가까운 이야기부터.

글링은 밴쿠버와 토론토에서 살아가는 한인들이 일상과 정보를 나누는 지역 커뮤니티입니다. 처음 정착하는 날의 질문부터 익숙한 동네의 새로운 발견까지, 한국어로 편하게 이야기하세요.

내 도시의 이야기
밴쿠버와 토론토의 피드를 골라 읽고, 라이프·맛집·여행·쇼핑·정착·이동·주거·교육·모임 카테고리로 관심 있는 글을 찾아보세요. 다른 도시는 순차적으로 열릴 예정입니다.

하루 한 편의 일상
사진과 글로 오늘의 이야기를 남겨보세요. 하루 한 편의 게시글을 중심으로, 반복 홍보보다 서로의 생활이 보이는 공간을 만듭니다.

댓글에서 대화와 모임까지
공감과 댓글로 마음을 전하고, 다시 읽고 싶은 글을 저장하세요. 더 나누고 싶은 이야기는 1:1 대화로 이어가고, 관심사가 맞는 지역 모임에 참여할 수 있습니다.

다른 생각도 함께
다른 의견이나 운영진 비판 자체를 이유로 제한하지 않습니다. 협박, 신상 공개, 사기와 괴롭힘처럼 타인에게 피해를 주는 행위에는 신고·차단과 운영 정책을 적용합니다.

이용 전 확인해주세요
게시글을 둘러보는 데는 로그인이 필요하지 않습니다. 글쓰기와 대화 등 계정 기능은 로그인과 프로필 설정 후 사용할 수 있습니다. 모든 새 게시글·댓글·대화는 동의를 거쳐 자동 안전 분석 대상이 되며, 권한 있는 관리자가 감사 기록을 남기며 검토할 수 있습니다. 대화는 종단간 암호화 서비스가 아닙니다.

문의: gling@ej-entertainment.com
개인정보처리방침: https://dlwpdl.github.io/gling/privacy
이용약관: https://dlwpdl.github.io/gling/terms

## App Review notes (English)

Gling is a Korean-language community app for Vancouver and Toronto, Canada. Other listed cities are marked as not yet open. The public feed can be browsed without signing in. Opening a post from the feed, posting, comments, direct messages and profile actions require authentication and onboarding. Shared public post links have a guest preview.

On iOS, the app includes native Sign in with Apple and Kakao sign-in. Before creating or continuing a profile, users must accept the terms, privacy policy and disclosed external AI safety processing. Development email/password login is excluded from Release builds.

Review path: open the app → browse Vancouver posts → select Toronto using the city picker → tap a post to see the sign-in prompt → choose Browse to return to the feed. Sign in to review post details, posting, comments, report/block actions and conversations. Account deletion is under Profile → Settings → Delete account and requires two confirmations; Apple-linked accounts reauthorize before token revocation and deletion. An external account-deletion request route is also published.

The service includes server-side content filtering, reporting and blocking. Its safety policy requires automated review of all new posts, comments and private/group messages, and audited access by authorized admins. Conversations are not end-to-end encrypted. AI does not make final permanent-ban decisions.

Camera and photo-library access are optional and requested when choosing or taking a photo. City selection is manual; this version does not request device GPS access. The current app does not contain advertising or in-app purchase SDKs.

**Do not submit these notes until production Apple sign-in, Apple token revocation, AI safety processing and signed-device flows are verified.** Provide working review access through App Store Connect if requested; never commit review passwords or administrative credentials.

## 심사 연락처

- 이름: Eunseok Choi (Rottery의 기존 등록 정보 확인)
- 이메일: `gling@ej-entertainment.com` (글링의 기존 고객지원 주소)
- 전화번호: Rottery의 등록 번호를 TestFlight 연락처에 저장. 전화번호 자체는 Git에 기록하지 않음.
- 위 연락처는 TestFlight에 반영했다. App Store 심사 정보는 실제 심사 로그인 수단을 준비한 뒤 생성해야 한다.

## App Privacy 답변 초안

모두 현재 `app.json` 선언을 바탕으로 한 초안입니다. 최종 바이너리, 서버 로그와 실제 제3자 처리 범위를 대조한 뒤 App Store Connect에서 확정합니다. `PrivacyInfo.xcprivacy`만으로 스토어의 개인정보 답변이 제출되지는 않습니다.

| 항목 | 사용 | 계정 연결 | 추적 |
| --- | --- | --- | --- |
| 이름, 이메일, 사용자 ID | 소셜 로그인, 프로필, 계정 관리 | 예 | 아니요 |
| 대략적인 위치 | 사용자가 선택한 도시·동네 | 예 | 아니요 |
| 사진, 기타 사용자 콘텐츠 | 프로필, 게시글, 댓글, 모임 | 예 | 아니요 |
| 이메일 또는 문자 메시지 | 앱 내 개인·그룹 메시지 | 예 | 아니요 |
| 고객지원 | 신고, 문의, 삭제 요청 | 예 | 아니요 |
| 제품 상호작용 | 반응, 저장, 조회, 공유, 운영 기록 | 예 | 아니요 |
| 민감 정보 | 사용자가 게시한 정치·종교 등 의견 및 안전 분석 대상 콘텐츠 | 예 | 아니요 |

기본 목적은 앱 기능입니다. 별도 광고 추적이나 기기 GPS 수집은 현재 코드에 없습니다. 운영 제공자가 수집하는 진단·보안 정보의 추가 신고 필요성을 최종 확인합니다. 외부 AI 제공자의 학습 미사용·보존 설정 및 계약 확인도 필요합니다.

## 연령 등급·출시 설정 초안

- 사용자 생성 콘텐츠, 메시지/채팅: 있음.
- 신고·차단 및 콘텐츠 필터: 구현됨; 실제 운영 동작 검증 필요.
- 광고, 실제 돈 도박, 모의 도박, 전리품 상자: 현재 구현 없음.
- 무제한 웹 접근: 내장 웹 브라우저 제공 여부와 외부 링크 동작을 기준으로 최종 답변.
- 욕설·폭력·성적 내용 등의 빈도: UGC의 실제 운영 범위와 현재 Apple 질문지에 따라 답변. 모두 없음으로 일괄 처리하지 않음.
- Kids 카테고리 대상 아님. 개인정보처리방침의 만 13세 미만 대상 아님 표기는 Apple 연령 등급과 별도이며 등급을 미리 확정하지 않음.
- 가격은 무료(CAD 0, 기준 지역 CAN), 수출 규정은 면제 암호화, 저작권은 위 표기로 저장했다. 배포 국가, 연령·개인정보 설문, 심사 로그인과 필요한 거래자 정보는 남아 있다.

## 공식 참고

- [App Review Guidelines: UGC, 로그인, 계정 삭제](https://developer.apple.com/app-store/review/guidelines/)
- [App Privacy 관리](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [스크린샷 규격](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Supabase Apple 로그인 설정](https://supabase.com/docs/guides/auth/social-login/auth-apple)
