# 글링 슬롯 카드와 카카오 로그인 — 빌드 9

## 변경

- 채팅·내 모임·멤버십에 공통 자리 카드: 남은 수치, 3/5/10칸, 사용 중/24시간 잠금/빈자리, 가장 빠른 반환 시각. 서버 조회 실패를 빈자리로 표시하지 않는다. 기존 슬롯·수락·잠금 정책은 그대로다.
- iOS ASWebAuthenticationSession은 최초 URL의 호스트를 안내하므로 앱 이름 변경이나 Kakao 개발자 콘솔 앱 이름만으로 Supabase 호스트가 바뀌지 않는다. 글링 소유 `https://gling.ej-entertainment.com/auth/kakao.html`에서 시작해 기존 Supabase Kakao PKCE 요청으로 연결한다. Android/web 기존 경로는 유지한다.
- 진입 페이지는 허용한 Supabase 프로젝트·authorize 경로·Kakao 제공자·등록된 native callback·PKCE·허용 query만 받는다. 임의 외부 redirect, 중복 query, 사용자정보 URL은 거부한다. 인증 요청은 fragment로 전달하고 redirect 전 history에서 제거한다. referrer·분석 스크립트·쿠키 저장을 추가하지 않는다.
- 공유 로그인 처리를 ref로 잠가 같은 프레임의 연타와 Kakao/Apple/심사/관리자 동시 요청을 차단한다. 취소·닫기·오류 뒤 finally에서 잠금과 로딩을 함께 해제한다. Apple 버튼도 로딩 중 동작하지 않는다.
- 별도 유료 인프라·새 패키지·DB 마이그레이션·구독/크레딧 변경 없음.

## 검증

- `npm test`: 72/72. `npm run typecheck`, `npm run lint`, `git diff --check` 통과.
- 실제 AuthProvider를 실행하는 회귀 검사: browser cancel/dismiss/rejection, 같은 프레임 두 번 누르기, Apple 동시 시작 차단, 취소 후 재시도. 변경 전 소스는 중복 호출 `2 !== 1`로 실패하고 변경 후 통과한다.
- 인증 진입 페이지 실제 script 실행: 허용 요청 보존, 다른 host/path/provider/callback, 중복 redirect, 미허용 query, 잘못된 PKCE, javascript URL 거부.
- [카드 디자인·접근성 QA](../output/design/gling-slot-cards/README.md): 작은 화면·큰 글자·다크 모드·서버 미확인·한도 초과 상태.
- 변경 전 Release 8 / iOS 26.5 시뮬레이터에서 첫 iOS 허용 팝업 취소, Kakao 웹 화면 X 닫기, 공감 로그인 modal에서 닫기 후 모두 원래 버튼으로 복구했다. 사용자가 보고한 단일 취소 후 영구 로딩은 아직 재현하지 못했으므로 중복 호출 결함과 동일 원인이라고 확정하지 않는다. 실기기 KakaoTalk 앱 전환 취소는 별도 확인 필요.
- 글링 인증 페이지 커밋 fe155f2, Pages 실행 34560392264 성공. 운영 HTML과 저장소 파일 일치.
- 새 simulator Release 9에서 실제 시스템 안내문 `‘글링’이(가) ‘gling.ej-entertainment.com’을(를) 사용하여 로그인하려고 합니다.` 확인. [안내창](../output/design/gling-login-build9/01-owned-domain-prompt.png).
- 새 simulator Release 9 빌드 성공. 번들에 글링 인증 URL·운영 Supabase URL 있음, 로컬 DB 주소 없음.

## 배포 진행

- iOS/Android 버전 1.0.0, 빌드 9 생성·서명 검증 완료.
- Google Play 기존 내부 테스트 트랙에 빌드 9를 게시했다. Console `내부 테스터에게 제공됨`, 9월 10일 오후 9:15 확인. API internal release versionCodes=[9], status=completed 재확인. 운영/비공개/공개 테스트 트랙은 변경 없음. 작업 탭 닫음.
- iOS IPA 운영 URL·글링 인증 URL·버전/번들 ID 확인 후 App Store Connect 업로드·처리 완료.
- 새 빌드 VALID와 TestFlight 그룹 연결을 확인한 뒤 기존 빌드 8 심사를 취소했다. Apple의 CANCELING → COMPLETE 전환을 기다린 뒤 빌드 9를 연결하고 새 심사 제출했다. 제출 86deeeed-7156-484d-aa26-e3ee81a1b1a5, 2026-09-11 04:22:30 UTC. 수동 출시 설정과 심사 계정·안전 운영 안내를 유지했다.

## 참고

- https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/
- https://developer.apple.com/documentation/authenticationservices/authenticating-a-user-through-a-web-service
- https://supabase.com/docs/guides/platform/custom-domains

- 네이티브 SDK의 plain PKCE는 마침표도 생성하므로 진입 페이지 허용 문자에 포함하고 재현 검사를 추가했다. 025655a / Pages 34561399982 성공, 운영 파일 일치. 새 Release 9에서 글링 안내창 → accounts.kakao.com 전환 확인.

- 새 Release 9에서 첫 iOS 팝업 취소와 Kakao 웹 화면 X 닫기 후 `카카오로 시작하기` 버튼 활성 복구, 이어서 재시도 확인. 심사 계정 실제 로그인 후 모임/1:1 각각 3칸·0사용·0잠금·3남음이 서버 값과 일치한다. [네이티브 카드](../output/design/gling-login-build9/03-native-slot-cards.png).
- IPA build c8fe1c3c-83d6-4c1e-9f3d-9fde07e8c1e2, processingState=VALID 확인.

- TestFlight Gling Internal 그룹에 빌드 9를 명시적으로 추가했고 그룹 조회로 확인했다. What to Test 한국어 안내 포함.

## 복구 및 확인 범위

로그인 진입 페이지 문제가 생기면 기존 허용 Supabase Kakao PKCE 요청을 보존하며 정적 페이지를 수정·재배포한다. 구독 판매 및 전체 콘텐츠 안전 운영은 변경하지 않는다. 실제 사용자 Kakao 계정의 최종 승인과 KakaoTalk 앱 전환 취소는 사용자 기기에서 추가 확인이 필요하다. 단일 취소 멈춤의 원인을 재현 없이 확정하지 않았다. 기존 native dependency 빌드 경고와 미준비 RevenueCat offering 오류는 이전 빌드와 동일하며, 새 dependency나 과금 설정을 추가하지 않았다.
