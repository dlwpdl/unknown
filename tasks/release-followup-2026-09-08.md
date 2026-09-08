# 글링 인증·스토어 후속 검증 — 2026-09-08

Android 내부 테스트 `1.0.0 (4)`를 출시했다. iOS 빌드 4 업로드와 스토어 필수 정보 보완도 완료했다. 실제 Kakao/Apple 계정의 가입·재로그인·탈퇴 검증과 Google 심사용 카카오 계정 준비는 남아 있으며, 공개 심사 제출이나 프로덕션 출시는 하지 않았다.

## 설치와 스토어 상태

- [Android 내부 테스트 참여](https://play.google.com/apps/internaltest/4701555384444643122): 소유자 Google 계정 `gling@ej-entertainment.com` 1명을 `글링 내부 테스트` 목록에 등록했다. Console에서 **활성 / 최신 출시 버전 1.0.0 (4) / 내부 테스터에게 제공됨**과 참여 링크 활성화를 재확인했다. 최초 심사 전에는 `com.dlwpdl.gling (unreviewed)`라는 임시 이름이 표시된다.
- Play의 테스터 미지정 경고는 해소됐다. 남은 ReTrace 경고 1개는 R8 난독화를 사용하지 않아 매핑 파일이 없는 경우다. AAB에는 네이티브 디버그 기호 48개가 첨부됐다. 공개 테스트나 프로덕션으로 승급하지 않았다.
- [App Store Connect](https://appstoreconnect.apple.com/apps/6809273242/distribution/ios/version/inflight): 빌드 `cde35d10-4251-4779-b0e2-4fb950ab254b`가 **VALID**이며 기존 버전 `1fe513b3-ec8d-4b00-bc4e-09c6a5087088`에 연결됐다. 버전은 수동 출시의 `PREPARE_FOR_SUBMISSION`이다. 한국어 What to Test도 저장했다. TestFlight 테스터 배포는 별도 단계다.
- `asc --profile gling validate --app 6809273242 --version-id 1fe513b3-ec8d-4b00-bc4e-09c6a5087088 --check-urls`: **오류 0, 경고 0**. 수동 출시와 API의 App Privacy 조회 한계에 대한 안내 2개만 남았다. `validate testflight`도 오류·경고 0이다. 실제 계정 인증 성공을 검사하는 명령은 아니다.
- App Privacy는 [브라우저 개인정보 페이지](https://appstoreconnect.apple.com/apps/6809273242/distribution/privacy)에서 **게시 완료**를 확인했다. 이름, 이메일, 대략적 위치, 민감 정보, 메시지, 사진, 고객지원, 기타 사용자 콘텐츠, 사용자 ID, 제품 상호작용 10종을 앱 기능 목적·사용자 연결·추적 없음으로 신고했다.
- Apple 연령 설문 24개와 심사 연락처·접근 안내를 저장했다. UGC·소셜·채팅과 일부 성숙한 주제·건강 정보 가능성을 반영하고, 구현하지 않은 연령 확인·부모 통제 기능을 있다고 신고하지 않았다. 실제 로그인 경로는 iOS의 Sign in with Apple이다.
- Apple 배포 국가는 **CAN, USA, KOR**만 `available=true`이며 새 국가 자동 추가는 꺼져 있다. 무료 가격은 유지했다.
- Google 콘텐츠 등급 설문을 소셜 앱, 신고·차단·채팅 중재 있음으로 저장했다. Console 계산 결과는 북미 Teen, 한국 12세 이상이며 Google 검토 전이다. 내용과 운영 정책이 바뀌면 설문도 갱신해야 한다.
- Google 데이터 보안은 **10종 답변을 모두 작성해 초안 저장**했다. 이름·이메일·사용자 ID·정치/종교 의견·기타 프로필/동의 정보·대략적 위치·인앱 메시지·사진·상호작용·사용자 콘텐츠를 신고했다. OAuth, 전송 구간 암호화, 외부 계정 삭제 요청 URL을 포함했다. 서비스 제공자가 지시에 따라 처리하는 전송 및 명시적 동의에 따른 전송에는 [Google의 공유 신고 예외](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)를 적용했다. 외부 OpenAI 처리 자체가 없다는 뜻은 아니며, 앱의 별도 AI 동의와 정책은 유지한다.
- Google 로그인 세부정보가 먼저 완료되어야 타겟층을 작성할 수 있고, 타겟층이 완료되어야 데이터 보안을 최종 저장할 수 있다. Console은 검토자가 신규 계정을 만들 수 없다고 명시한다. 개인 계정이나 가짜 인증 정보를 심사용으로 제출하지 않았다.

## 운영 인증과 탈퇴 수정

운영 프로젝트는 기존 `wjvahbdwmctzpkndqaxa`다. 카카오의 이메일 권한 오류 수정은 [빌드 3 기록](auth-verification-2026-09-07.md#후속-수정-카카오-koe205-빌드-3)을 유지한다. 공통 로그인 요청은 `profile_nickname profile_image`만 요청하고, Google 로그인은 비활성 상태다.

- Supabase의 Apple 공급자를 활성화하고 native client ID를 `com.dlwpdl.gling`으로 설정했다. 운영 설정 조회에서 Apple·Kakao 활성, Google 비활성을 확인했다. 네이티브 ID token 흐름에 맞춰 설정했으며 웹용 Services ID를 새로 만들지 않았다.
- Gling 전용 Sign in with Apple 키 `F5N57692CC`를 Gling 기본 App ID에 연결했다. Rottery 키는 변경하지 않았다. ES256 client secret의 서명을 로컬에서 검증하고 `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`을 서버에 설정했다.
- Apple 토큰 API에 의도적으로 잘못된 코드를 전달한 확인은 `invalid_grant`였다. 클라이언트 자격 증명이 인식되는 검증이며, 실제 로그인·연결 해제 성공을 의미하지 않는다.
- 기존 탈퇴 호출은 외부 계정 재인증 전에 클라이언트가 이미지를 삭제했다. 이제 공통 클라이언트 함수는 서버만 호출한다. 서버에서 인증된 사용자와 연결 계정을 확인하고 Apple 토큰 철회/Kakao 연결 해제 성공 후에만 이미지 → 앱 데이터 → 인증 계정을 삭제한다.
- Apple 재인증 결과의 사용자 식별자가 로그인한 Apple 사용자와 일치해야 한다. Kakao 연결 해제는 요청 본문의 ID 대신 인증 서버가 반환한 본인 식별자를 사용한다. 연결 해제 실패·응답 ID 불일치·통신 오류 시 파일과 계정 데이터 삭제를 중단한다. Kakao의 이미 연결 해제됨(`400/-101`) 응답은 재시도를 허용한다.
- **`KAKAO_ADMIN_KEY`는 아직 미설정이다.** 카카오 개발자 콘솔은 로그인 화면이며 이용 가능한 저장 로그인 정보가 없었다. 키가 없는 동안 Kakao 탈퇴는 `503 KAKAO_UNLINK_NOT_CONFIGURED`로 중단된다. 이 상태를 정상 탈퇴 완료로 표시하지 않는다.
- `delete-account` 운영 배포는 **ACTIVE, 함수 버전 4, verify_jwt=true**다. 별도 일회용 Auth 사용자로 실제 ES256 세션을 발급해 잘못된 확인 문구를 전달했을 때 `400 CONFIRMATION_REQUIRED`를 받았다. 검사 계정은 정리했고 개인 계정이나 서비스 콘텐츠는 삭제하지 않았다.

Apple client secret은 **2027-02-05 08:47:56 UTC**에 만료된다. **2027-01-06 이전 갱신**을 운영 작업으로 잡아야 한다. 키와 생성 메타데이터는 `~/Library/Application Support/gling/credentials/`에 있으며 디렉터리는 0700, 비밀 파일은 0600이다. 원본 `AuthKey_F5N57692CC.p8`로 새 client secret을 생성해 운영 secret을 교체한다. 키 본문과 JWT, OpenAI·Resend 키는 Git에 저장하지 않는다.

## 안전 모니터링 연결

- 기존 소유자 Google SSO로 OpenAI와 Resend에 접속했다. OpenAI `Gling production` 키는 필요한 Responses 권한으로 제한했고, Resend `Gling safety` 키는 Sending access로 생성해 서버에 설정했다.
- 합성 입력의 `gpt-5-mini` Responses 요청이 HTTP 200으로 완료됐다. 기존 cron의 전체 콘텐츠 안전 검토 범위와 명시적 동의 조건을 유지했다. 확인 당시 게시글 35건·댓글 62건의 검토가 완료됐으며, AI 동의가 없는 메시지 1건은 `AI_CONSENT_REQUIRED`로 전송이 차단됐다. 동의를 대신 설정하지 않았다.
- Resend의 공식 배송 시뮬레이터 주소로 합성 메일을 보내 HTTP 200을 확인했다. 실제 개인 수신함·관리자 경보 수신까지 검증한 것은 아니다. 다른 프로젝트의 도메인과 키는 변경하지 않았다.

## 검증과 산출물

`npm test` **39/39**, `npm run typecheck`, `npm run lint` 통과. 새 검사 `scripts/delete-account.test.mjs`는 실제 Edge Function 진입점을 기존 Supabase SDK와 모의 외부 응답으로 실행한다. 실패 시 데이터 보존, 본인 식별자, 재시도, 정상 삭제 순서를 검사한다. DB migration 변경은 없으며 기존 162개 DB 검사는 반복하지 않았다.

iOS archive·App Store export, Android `bundleRelease`·`assembleRelease`가 성공했다. iOS 서명과 IPA의 Bundle ID·버전·빌드 번호를 검사했다. Android 업로드 인증서, versionCode 4, target SDK 36, 비디버그 빌드, 불필요한 오버레이·마이크 권한 없음과 16KB 정렬을 확인했다. 네이티브 의존성의 기존 빌드 경고까지 모두 제거됐다는 뜻은 아니다.

새 iPhone 16e / iOS 18.4 시뮬레이터에서는 변경하지 않은 빌드 3의 기본 인증 세션으로 카카오 계정 입력 화면에 도달했다. 이전 시뮬레이터의 네트워크 오류가 모든 iOS 설치에서 발생하는 것으로 확인되지는 않았다. 임시 브라우저 세션 강제나 ATS 예외를 제품 코드에 추가하지 않았다. 실제 사용자 인증 완료는 여전히 미검증이다.

배포 파일은 `~/Library/Application Support/gling/releases/1.0.0-4/`에 보관한다. 같은 폴더의 `google-data-safety-draft.csv`는 저장된 Google 초안을 다시 내보낸 파일이며, 10종 선택·OAuth·암호화 응답을 재검증했다. IPA·AAB·APK·dSYMs·서명 키는 Git에서 제외한다.

| 파일 | SHA-256 |
| --- | --- |
| `gling-1.0.0-4.ipa` | `50f125225558d9fe357a14ad0911649a08604c62a16620cf81f08e099961d311` |
| `gling-1.0.0-4.aab` | `8c0651a104eb16f816bcbd2bcb9a5bae1ae74f4e686dcd27d4123d7f7b359791` |
| `gling-1.0.0-4.apk` | `f745f6436772b2925a154f0ccf70e44beec43de75bd96e808a1170f1651539b8` |

작업 로그와 원격 상태 증거는 `/tmp/gling-auth-followup-2026-09-08/`에 있다. 현재 Expo prebuild 결과의 iOS workspace/scheme은 `ios/app.xcworkspace` / `app`이며 prebuild 뒤 `pod install --project-directory=ios`가 필요하다.

## 다음 검증과 중단 방법

1. 열린 카카오 개발자 콘솔에서 계정 인증 후 Gling 앱의 Admin Key를 서버에 등록한다. 별도의 심사용/탈퇴 검증용 카카오 계정을 준비한다. 소유자의 개인 계정은 삭제 검사에 사용하지 않는다.
2. 빌드 4에서 실제 Kakao/Apple 가입, 동의, 앱 복귀, 재실행 세션 복원, 재로그인과 테스트 계정 탈퇴를 확인한다. 정상 계정에서 글·댓글·대화·신고·차단과 관리자 경보의 실제 수신을 확인한다.
3. Google 로그인 세부정보 → 타겟층 → 작성된 데이터 보안 초안 확정을 진행하고, 아동 안전 표준 등 남은 앱 콘텐츠 선언을 검토한다. 공개 출시에는 Console에 표시된 **12명 이상·14일 이상 비공개 테스트**가 별도로 필요하다. 내부 테스트 활성화는 이 조건을 충족하지 않는다.
4. 문제 발생 시 Play 내부 트랙의 `트랙 일시중지`로 추가 제공을 중단한다. iOS는 아직 공개 제출 전이다. 이전 서버 원본은 `/tmp/gling-auth-followup-2026-09-08/rollback/`에 보관했지만 외부 연결 해제 누락과 클라이언트 선삭제 문제를 되살리는 단순 롤백은 피한다. 원인을 수정하고 버전 코드를 증가시킨 빌드를 배포한다.
