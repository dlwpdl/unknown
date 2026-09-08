# 글링 B 디자인 스토어 업데이트 — 2026-09-07

기존 `dlwpdl/gling` / `mobile-app`의 디자인 커밋 `4d56545`를 배포 파일로 만들었다. 첫 출시 전 버전 `1.0.0`을 유지하고 iOS buildNumber와 Android versionCode를 `2`로 올렸다. 앱 표시명은 `글링`, 양쪽 식별자는 `com.dlwpdl.gling`이다.

## 원격 반영 결과

- [App Store Connect](https://appstoreconnect.apple.com/apps/6809273242/distribution/ios/version/inflight): 새 빌드 `292241c4-188a-498e-963c-45b0b369af32`가 `VALID`이고 기존 버전 `1fe513b3-ec8d-4b00-bc4e-09c6a5087088`에 연결됐다. 상태는 `PREPARE_FOR_SUBMISSION`, 수동 출시다.
- 한국어 스크린샷 세트 `4c961af8-7a85-42c4-b603-c002f5092525`의 이미지 3장을 교체했다. 새 이미지의 `COMPLETE`와 MD5 일치를 확인한 뒤 이전 3장을 삭제했고, 최종 개수·순서·체크섬을 다시 검증했다.
- [한국어 변경 안내](../release/notes-1.0.0-2-ko.txt)와 남은 검증 범위를 TestFlight What to Test에 저장했다. 테스터 초대·배포·심사 제출은 하지 않았다.
- [Google Play Console](https://play.google.com/console/u/0/developers/4802509944213002773/app/4972349784406622597/app-dashboard): Eunsense Studio 로그인 세션이 없어 **빌드 2 업로드와 스크린샷 교체는 대기 중**이다. 기존 내부 테스트 트랙 `4701555384444643122`의 빌드 1 초안이 마지막으로 확인된 상태다. 다른 계정이나 앱에는 변경하지 않았다.

새 iOS 스크린샷 ID는 순서대로 `109f70ce-b208-4e2e-af3d-a0bcd2cf5318`, `5112cc08-8024-4a67-ad64-d55c069ceb07`, `4d515388-d27c-4d5d-b393-26fef76f5e08`이다.

## 빌드와 보관

배포 파일은 `~/Library/Application Support/gling/releases/1.0.0-2/`에 보관했다. 같은 폴더에 `dSYMs.zip`과 `notes-ko.txt`가 있다. 서명 키와 인증 정보는 기존 보호 위치를 재사용하며 Git에 넣지 않는다. 작업 로그와 원격 재조회 결과는 `/tmp/gling-store-update-2/`에 있다.

| 파일 | SHA-256 |
| --- | --- |
| `gling-1.0.0-2.ipa` | `5bdad0c3b7485823a1cd1bfc10f55255efc2822d22e113e76478ba73db9037ff` |
| `gling-1.0.0-2.aab` | `444e512eadd2f1f464774443834dfcb22e4e778e36b4a4f2076c721340e2dad9` |
| `gling-1.0.0-2.apk` | `3ceb3ed72462e885ca31eae1423d48845ee5b983cf9d8b53b09637488215aa74` |

`CI=1 npx --no-install expo prebuild --no-install`과 `pod install --project-directory=ios`로 네이티브 프로젝트를 생성했다. 한글 표시명 때문에 현재 iOS workspace는 `ios/app.xcworkspace`, scheme은 `app`이다. 이전 기록의 `gling` 경로는 당시 생성된 이름이다. Release 시뮬레이터 빌드, 기기 Archive, `app-store-connect` 방식의 Export를 완료했다. ExportOptions는 기존 `/tmp/gling-release/ExportOptions.plist`를 재사용했다.

Android는 [기존 출시 명령](google-play-release-2026-09-06.md#빌드서명과-재현)의 AGP 서명 주입으로 `bundleRelease`와 `assembleRelease`를 실행했다. JDK 17과 기존 Android SDK를 사용했다. AAB·APK 인증서 SHA-256은 기존 키와 같은 `41:3E:75:95:7C:F6:04:FD:22:5A:37:52:7C:CE:90:B7:37:9F:32:26:B5:72:F2:B5:89:C7:73:96:DC:BF:EF:BD`다.

## 검증

- `npm test` 38/38, TypeScript, ESLint, `expo install --check` 통과. 운영 의존성 감사의 high·critical은 0, 기존 moderate 14개는 남아 있다.
- IPA의 실제 번들 ID·표시명·버전·빌드 번호·암호화 선언을 확인했다. `codesign --verify --deep --strict`와 App Store entitlement 검사 통과.
- AAB의 `jarsigner -verify`, APK의 `apksigner verify`와 16KB zip 정렬 검사 통과. targetSdk 36, versionCode 2, 비디버그 빌드이며 SYSTEM_ALERT_WINDOW·RECORD_AUDIO 권한이 없다.
- `asc validate testflight`는 새 빌드 기준 오류 0·경고 0. Apple 처리 완료와 버전의 빌드 연결을 API로 재조회했다.
- [iOS 스크린샷](../release/app-store/README.md) 3장은 iPhone 16 Pro Max / iOS 18.4 Release의 1320×2868 화면이다. 도시 선택, 글쓰기 로그인 안내와 둘러보기 복귀를 확인했다. 시뮬레이터에서 토론토가 잠시 빈 상태로 표시된 뒤 재시작 후 예시 피드를 확인했으므로 실시간 피드의 안정성은 실기기에서도 재확인해야 한다.
- [Android 스크린샷](../release/google-play/README.md) 4장은 Pixel 9 / Android 16(API 36) Release의 1080×1920 화면이다. 설치·실행·밴쿠버/토론토 전환·맛집 필터·게스트 글쓰기 로그인 안내를 확인했다. 로그인 안내와 도시 시트에서 시스템 뒤로가기로 피드에 복귀했고, 확인한 AndroidRuntime·ReactNativeJS 오류 로그는 비어 있었다. 창 렌더러가 멈춰 최종 검증은 같은 AVD를 `-no-window -no-audio -gpu swiftshader`로 다시 실행했다.
- 이미지는 실제 앱에서 촬영했으며 서버 시드와 앱에 포함된 예시 게시글 표기를 유지했다. 디자인 보고서의 합성 사진은 넣지 않았다. Apple/Kakao 계정 인증 완료, 로그인 후 작성·댓글·메시지 전체 흐름, iOS 시트의 손가락 드래그는 이번 검증에 포함되지 않는다.

## 이어서 할 일과 되돌리기

Play Console의 Eunsense Studio 로그인을 복구하면 위 AAB를 기존 내부 테스트 초안에 올리고, 변경 안내와 `release/google-play/phone/`의 PNG 4장을 반영한 뒤 저장 결과를 재조회한다.

공개 심사 검사는 기존 필수 누락 26개(연령 설문 24개, 심사 정보, 배포 국가)를 보고했다. App Privacy, 실제 인증, 서버 안전 분석·관리자 알림과 테스트 요건 등은 [기존 출시 기록](release-status-2026-09-06.md#심사-제출-전-필수-작업)을 따른다. 빌드·이미지 업데이트는 공개 출시 완료를 의미하지 않는다.

문제가 생기면 ASC 초안의 선택 빌드를 기존 빌드 `b6712770-ae17-4267-90f0-37ab3bac8b39`로 돌리고 Git의 이전 스크린샷을 다시 올린다. DB·서버 설정 변경은 없다.

기준: [Apple 빌드 업로드](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [Apple 스크린샷 규격](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [Google Play 버전 준비](https://support.google.com/googleplay/android-developer/answer/9859348), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
