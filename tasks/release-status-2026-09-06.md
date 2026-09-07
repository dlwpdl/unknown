# 글링 iOS 출시 준비 — 2026-09-06

현재 상태: 코드·배포용 빌드·스토어 초안 준비. 운영 인증과 안전 모니터링 검증이 남아 있어 심사 제출 및 공개 출시는 하지 않았습니다. 이후 진행한 Android 등록·검증은 [Google Play 출시 기록](google-play-release-2026-09-06.md)을 참조합니다.

## 저장소와 앱

- 저장소: [dlwpdl/gling](https://github.com/dlwpdl/gling), 브랜치 `mobile-app`만 사용합니다.
- 이번 작업 전 기준 커밋: `4a20b7cc5322192fe98eaafb920d841514660d28`.
- App Store Connect: [글링, Apple ID 6809273242](https://appstoreconnect.apple.com/apps/6809273242/distribution/ios/version/inflight).
- Bundle ID `com.dlwpdl.gling`, Apple Team `P3X3452TDZ`, 버전 `1.0.0`, 빌드 `1`, iPhone 대상.
- 한국어 이름·부제·카테고리·소개·프로모션·키워드·지원/마케팅/개인정보 URL을 초안에 저장했습니다. 출시 방식은 수동입니다.
- 고객지원은 기존 앱·정책의 `gling@ej-entertainment.com`을 유지합니다.
- 6.9인치 스크린샷 3장도 저장했고 6.5인치는 동일 자료를 사용합니다. TestFlight의 `1.0.0 (1)` 처리가 완료되어 ‘제출 준비 완료’ 상태를 확인했습니다. 테스터 초대와 공개 심사 제출은 하지 않았습니다.
- [한국어 메타데이터와 심사 메모 초안](app-store-metadata-ko-KR.md), [실제 화면 자료](../release/app-store/README.md).

## 변경 사항

- Expo SDK 57 호환 검사에 맞춰 기존 Expo, Router, Image Picker, Expo UI의 패치 버전을 갱신했습니다. 새 기능용 의존성은 추가하지 않았습니다.
- 글쓰기 탭에 큰 원본 브랜드 이미지가 그대로 표시되어 본문을 덮는 iOS 오류를 고쳤습니다. 다른 탭과 같은 SF Symbol / Material 아이콘 경로를 재사용했습니다.
- 첫 업로드의 수출 규정 질문에 현재 앱의 OS 제공 통신·인증 범위에 맞게 답변했습니다. 다음 빌드부터 같은 정보가 포함되도록 `ios.config.usesNonExemptEncryption=false`를 추가하고 Expo introspect 결과의 `ITSAppUsesNonExemptEncryption=false`를 검증했습니다. 업로드한 빌드 1은 App Store Connect에서 질문에 답변한 상태이며 이 plist 설정은 다음 빌드에 반영됩니다. [Apple 암호화 안내](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)를 참조했습니다.
- 기존 Node 테스트 전체를 실행하는 `npm test` 명령과 실제 프로젝트 README를 정리했습니다.
- DB migration, 운영 데이터, 기존 안전 정책은 변경하지 않았습니다.

## 검증 결과

| 확인 | 결과 |
| --- | --- |
| `npm test` | 기존 테스트 37개 통과 |
| `npm run typecheck`, `npm run lint` | 통과 |
| `npx expo install --check` | SDK 의존성 일치 |
| `npx expo export --platform web` | 성공 |
| `npx supabase test db` | 로컬 DB의 15개 파일, 162개 테스트 통과 |
| `npx supabase migration list --linked` | 로컬/운영 migration 0001–0022 일치 |
| 운영 공개 피드 API | 익명 호출 성공; 밴쿠버 예시 게시글 20개 응답 |
| 지원·privacy·terms·account-deletion 페이지 | 모두 HTTP 200 |
| iOS Simulator Release | 빌드·설치·Metro 없는 실행 성공 |
| 실제 화면 확인 | 밴쿠버/토론토 피드, 지역 선택, 상세 로그인 안내와 둘러보기 복귀, 수정된 탭 크기 확인 |
| iOS archive / App Store export | 모두 성공 |

`npm audit --omit=dev`에는 moderate 14개가 남아 있습니다(high/critical 0). 이번 패치 갱신만으로 모든 의존성 취약점이 해소된 것은 아닙니다. 운영 Supabase Security Advisors는 ERROR 0이며 공개 스키마 citext, security-definer RPC 실행 권한, 유출 비밀번호 보호 관련 WARN을 보고했습니다. 공개 피드 RPC는 의도적으로 익명에게 허용되므로 일괄 권한 회수를 하지 않았습니다. 각 RPC의 접근 경계는 기존 DB 테스트 범위에서 검증했으며, 경고 전체가 해소됐다는 뜻은 아닙니다.

## 빌드 산출물과 재현

Xcode 26.6 (17F113), iOS SDK 26.5. 실제 캡처 기기는 iPhone 16 Pro Max 시뮬레이터 / iOS 18.4, 1320×2868입니다. 네이티브 `ios/`는 생성 폴더이며 저장소에서 제외합니다.

```sh
npx expo prebuild --platform ios --no-install
pod install --project-directory=ios
xcodebuild -workspace ios/gling.xcworkspace -scheme gling -configuration Release \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/gling-release/simulator CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace ios/gling.xcworkspace -scheme gling -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/gling-release/Gling.xcarchive \
  -derivedDataPath /tmp/gling-release/device -allowProvisioningUpdates archive
```

두 네이티브 빌드는 같은 Pods 경로를 사용하므로 순서대로 실행합니다. 빌드 과정에서 `.env.local`의 공개 클라이언트 설정이 포함됩니다. 서버 비밀키는 포함하지 않습니다.

- 로컬 archive: `/tmp/gling-release/Gling.xcarchive`
- 로컬 배포 IPA: `/tmp/gling-release/export/gling.ipa` (약 22.7 MB)
- 배포 서명: Cloud Managed Apple Distribution, `get-task-allow=false`, Sign in with Apple entitlement 포함.
- Export options: `method=app-store-connect`, `destination=export`, `signingStyle=automatic`, `teamID=P3X3452TDZ`.
- 로그: `/tmp/gling-release/{simulator-build,archive,export,upload}.log`.
- 임시 경로는 정리될 수 있으므로 보관할 배포 파일은 별도 안전한 위치에 복사합니다. IPA·인증서·키는 Git에 올리지 않습니다.

App Store Connect 업로드도 성공했습니다(`Uploaded gling`, 2026-09-06 18:35 PDT). ExpoImage, React, ReactNativeDependencies, SDWebImage 계열 및 Hermes의 dSYM 누락 경고 8개가 있어 해당 프레임워크 내부 크래시의 심볼 해석이 제한될 수 있습니다. 앱 업로드 자체는 성공했으며, 공급된 바이너리와 일치하는 심볼 확보는 후속 작업입니다.

## 심사 제출 전 필수 작업

1. **Apple 로그인 및 탈퇴**: 운영 `/auth/v1/settings`에서 Apple은 비활성 상태입니다(Kakao 활성, Google 비활성). 기존 Bundle ID에 맞게 Supabase Apple 공급자를 설정합니다. `delete-account` 함수가 Apple 토큰을 폐기할 수 있도록 `APPLE_CLIENT_SECRET`을 서버에 설정하고 만료 전 갱신을 관리합니다. 최초 가입, 재로그인, Apple 재인증을 거친 계정 삭제를 실기기에서 확인합니다.
2. **AI 안전 모니터링**: `OPENAI_API_KEY`가 운영 secrets에 없습니다. `safety-monitor`는 키가 없으면 HTTP 503을 반환하며 작업을 처리하지 못합니다. 매분 실행되는 cron은 활성화되어 있고 조회 시 검토 대기 98건이 있었습니다. 키 설정 후 신규 게시글·댓글·개인/그룹 메시지가 모두 큐에 들어가 처리되고 관리자가 감사 기록을 남기며 확인할 수 있는지 검증합니다. 기존 전체 콘텐츠 검토 정책은 유지합니다.
3. **관리자 경보**: `ADMIN_ALERT_EMAIL`과 `SAFETY_MONITOR_SECRET`은 존재하지만 `RESEND_API_KEY`는 없습니다. Resend 키와 허용 발신자/수신자 설정을 확인하고 실제 테스트 경보 수신을 검증합니다. 현재 함수 발신자는 `onboarding@resend.dev`입니다.
4. **기능 실기기 확인**: iPhone이 연결되지 않아 Apple/Kakao 인증 완료, 사진 선택·촬영, 게시·댓글·모임·채팅, 신고·차단, 온보딩 동의와 탈퇴의 전체 흐름은 검증하지 못했습니다. 동의 없는 외부 AI 전송을 허용하지 않습니다.
5. **스토어 최종 정보**: App Privacy와 연령 등급 문답을 실제 운영 처리 범위에 맞게 확정하고, 심사 접근 방법·연락처 전화번호·저작권자·가격/국가·필요한 거래자 정보를 채웁니다. 자동 안전 분석이 동작하기 전에 해당 동작을 설명하는 초안으로 심사를 제출하지 않습니다.

비밀키는 채팅이나 Git에 기록하지 않고 Supabase 프로젝트의 Edge Function secrets에 설정합니다. 인증 공급자 활성화와 Edge Function secret 설정은 별개입니다. Google은 현재 iOS 로그인 UI의 출시 필수 공급자가 아닙니다.

## 배포와 되돌리기

출시 준비 커밋 `cfb76d2`를 기존 `origin/mobile-app`에 푸시했습니다. [해당 커밋의 GitHub Pages 배포](https://github.com/dlwpdl/gling/actions/runs/34073755294)가 성공했습니다. `mobile-app` 푸시는 기존 GitHub Pages 워크플로를 실행합니다. 변경을 되돌려야 하면 이번 출시 준비 커밋을 revert한 후 같은 브랜치에 푸시합니다. DB migration 변경이 없어 DB 롤백은 필요하지 않습니다. TestFlight에 올린 빌드가 있어도 공개 심사는 별도로 제출해야 하며, 운영 필수 검증이 완료되기 전에는 제출하지 않습니다.
