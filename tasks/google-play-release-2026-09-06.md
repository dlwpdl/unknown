# 글링 Android 등록 — 2026-09-06 (PDT)

**최신 상태(2026-09-08):** 빌드 4를 내부 테스터에게 출시하고 소유자 1명을 등록했다. 테스터 미지정 경고는 해소됐다. 콘텐츠 등급을 저장하고 데이터 보안 10종을 초안 작성했다. 설치 링크와 남은 Google 심사 계정·비공개 테스트 요건은 [후속 기록](release-followup-2026-09-08.md)을 참조한다. 아래는 최초 등록 기록이다.

## Play Console

- 기존 Eunsense Studio 계정 `4802509944213002773`에 [글링](https://play.google.com/console/u/0/developers/4802509944213002773/app/4972349784406622597/app-dashboard)을 등록했다. 다른 GitHub 저장소나 개발자 계정은 만들지 않았다.
- Play 앱 ID: `4972349784406622597`. 패키지: `com.dlwpdl.gling`. 무료 앱, 소셜 카테고리, 기본 언어 `ko-KR`.
- 이름: `글링` (2/30자). 브랜드 확정 후 기존 `글링 - 캐나다 한인 커뮤니티`에서 변경했다. `app.json`의 홈 화면 이름도 `글링`으로 설정했으며 이미 업로드된 빌드 1에는 포함되지 않아 다음 네이티브 빌드부터 적용된다.
- 간단한 설명: `밴쿠버·토론토 한인들의 일상, 정착 정보, 맛집과 모임을 한국어로 나누세요.` (42/80자).
- 자세한 설명: [App Store 메타데이터](app-store-metadata-ko-KR.md)의 설명 820자를 재사용했다.
- 지원 이메일 `(소유자 Gmail)`, 웹사이트 `https://dlwpdl.github.io/gling`, 개인정보처리방침 `https://dlwpdl.github.io/gling/privacy`를 저장했다.
- [이미지 자료](../release/google-play/README.md): 아이콘 512×512, 홍보 이미지 1024×500, 실제 Android 화면 1080×1920 4장. 홍보 이미지에는 Console의 AI 생성 애셋 라벨을 지정했다. 스토어 등록정보 상태는 **검토를 위해 전송 준비 완료**이며, 검토 전송은 하지 않았다.
- [내부 테스트 버전](https://play.google.com/console/u/0/developers/4802509944213002773/app/4972349784406622597/tracks/4701555384444643122/releases/1/review): `1.0.0 (1)` AAB 업로드·처리 완료, 한국어 출시 노트와 함께 초안 저장. Console에서 API 24 이상 / target 36 / ABI 4개 / 설치 크기 29.6 MB를 확인했다. 테스터 추가·초대·출시는 하지 않았다.
- 내부 버전 검증은 오류 없이 경고 2개: 테스터 미지정, R8/ProGuard 가독화 파일 없음. Expo 기본값에서 `minifyEnabled=false`이므로 앱의 R8 매핑 파일이 생성되지 않는다. 네이티브 디버그 기호는 AAB에 첨부되어 Console에서 확인됐다.
- 현재 코드·의존성·병합 Manifest에 맞춰 광고 없음, 광고 ID 미사용, 정부 앱 아님, 금융 기능 없음, 건강 기능 없음 선언을 저장했다.

## Android에서 수정한 문제

1. `app.json`에 Android 패키지·버전 코드 1을 명시했다.
2. 앱에서 쓰지 않는 `SYSTEM_ALERT_WINDOW`를 Expo `blockedPermissions`로 제거했다. 최종 병합 Manifest에 오버레이·마이크 권한이 없음을 확인했다.
3. 밝은 화면에서 상태 표시줄이 흰색으로 남는 문제를 네이티브 루트의 기존 `expo-status-bar`로 수정했다. `style="auto"`로 밝은/어두운 테마 모두 실제 기기 렌더를 확인했다. [Expo 57 공식 문서](https://docs.expo.dev/versions/v57.0.0/sdk/status-bar/).
4. Android의 카카오 전용 화면에 Apple 로그인을 안내하던 공통 문구를 `소셜 계정으로 간편하게 시작해요.`로 고쳤다.

3·4번은 공통 네이티브 소스/문구 변경이며 이미 업로드된 iOS 빌드 1에는 포함되지 않는다. 다음 iOS 빌드에서 반영한다.

## 빌드·서명과 재현

Expo 57.0.20 / React Native 0.86.3 / JDK 17 / Gradle 9.3.1 / AGP 9.0.1 / Android compile·target SDK 36 / min SDK 24. EAS나 새 앱 의존성 없이 기존 로컬 Android SDK와 Gradle로 만들었다.

업로드 키는 저장소 밖 `~/Library/Application Support/gling/android-signing/`에 있다. `gling-upload.p12`와 `credentials.json`은 0600, 디렉터리는 0700이다. RSA 4096비트, alias `gling-upload`. 이후 업데이트에서도 이 키를 재사용하고 별도 안전한 백업을 보관해야 한다. 비밀번호·키를 Git에 넣지 않는다.

업로드 인증서 SHA-256:

```text
41:3E:75:95:7C:F6:04:FD:22:5A:37:52:7C:CE:90:B7:37:9F:32:26:B5:72:F2:B5:89:C7:73:96:DC:BF:EF:BD
```

로컬 `.env.local`의 운영 공개 Supabase 설정이 있는 저장소 루트에서 실행한다. 자격 증명 JSON의 기존 키 이름만 사용하며 값은 출력하지 않는다.

```sh
CI=1 npx --no-install expo prebuild --platform android --no-install
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path

credentials = json.loads((Path.home() / 'Library/Application Support/gling/android-signing/credentials.json').read_text())
build_env = os.environ.copy()
build_env['JAVA_HOME'] = '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home'
build_env['ANDROID_HOME'] = '/opt/homebrew/share/android-commandlinetools'
for option, value in {
    'store.file': credentials['storeFile'],
    'store.password': credentials['storePassword'],
    'key.alias': credentials['keyAlias'],
    'key.password': credentials['keyPassword'],
    'store.type': 'PKCS12',
}.items():
    build_env['ORG_GRADLE_PROJECT_android.injected.signing.' + option] = value
subprocess.run(['./gradlew', ':app:bundleRelease', ':app:assembleRelease', '--console=plain', '--max-workers=4'], cwd='android', env=build_env, check=True)
PY
```

AGP의 기본 서명 주입 기능을 사용한다. Expo 템플릿의 debug 키로 잘못 서명되지 않도록 업로드 전 AAB/APK 인증서가 위 지문과 일치하는지 확인한다. 다음 Play 업로드에서는 `android.versionCode`를 증가시킨다.

| 산출물 | 경로 / SHA-256 |
| --- | --- |
| AAB | `/tmp/gling-android-release/gling-1.0.0-1.aab` |
| AAB SHA-256 | `71baf736903320ede6e8b718ea3d30c695c694f6eea40c2022d44f31e345aecd` |
| APK | `/tmp/gling-android-release/gling-1.0.0-1.apk` |
| APK SHA-256 | `e2a4216ae129744f3b33a99de274d5e51134bb2e3d08c1ecb5760534ef716b21` |
| 최종 빌드 로그 | `/tmp/gling-android-release/build-ready.log` |

## 검증

- Android JS export, `:app:bundleRelease :app:assembleRelease`, `npm run typecheck`, `npm run lint`, `expo install --check` 통과.
- `jarsigner -verify` → `jar verified`; AAB 인증서와 보호된 업로드 키 지문 일치. 자체 서명 Android 인증서의 신뢰 체인/타임스탬프 경고는 기록만 남겼다.
- `apksigner verify --print-certs` 및 `zipalign -c -P 16 4` 통과.
- 최종 Release APK를 Pixel 9 / Android 16 에뮬레이터 `Gling_API_36`에 설치하고 Metro 없이 실행했다. 밴쿠버·토론토, 도시 선택, 카테고리 필터, 글쓰기 로그인 게이트와 둘러보기 복귀를 확인했다.
- 밝은/어두운 테마 상태 표시줄 가독성 확인. UIAutomator XML에서 카카오 버튼·수정된 안내 문구를 확인했고 Apple 버튼과 개발 로그인 입력은 노출되지 않았다. 실행 중 `AndroidRuntime:E`, `ReactNativeJS:E` 로그 없음.
- 스크린샷 4장과 홍보 이미지·아이콘을 직접 열어 확인했고 규격·파일 크기 검증 통과.
- 실제 카카오 인증 완료, 가입 후 글쓰기·대화, 실기기 카메라, 계정 삭제는 이번 Android 검증에 포함하지 않았다. 기존 iOS/DB 검증은 [이전 기록](release-status-2026-09-06.md)을 참조한다.

## 공개 출시 전 남은 작업

1. 이 개인 개발자 계정은 **12명 이상이 14일 이상 참여하는 비공개 테스트** 후 프로덕션 액세스를 신청해야 한다. Console에서 참여 테스터는 0명이다. 내부 테스트 초안 저장은 이 요건을 충족하지 않는다.
2. 실제 카카오 계정으로 로그인·가입·글쓰기·대화·탈퇴를 검증하고 Google 검토자가 사용할 수 있는 로그인 접근 정보를 준비한다.
3. 데이터 보안·콘텐츠 등급·타겟층을 실제 운영 데이터 흐름과 제공자 처리 조건에 맞춰 완료한다. 수집하는 계정/도시/게시글·사진·대화/신고·안전 분석 데이터를 누락하거나 수집 없음으로 선언하지 않는다. 계정 삭제 URL은 `https://dlwpdl.github.io/gling/account-deletion`이다.
4. 공통 운영 서버의 `OPENAI_API_KEY`, `RESEND_API_KEY` 설정과 전체 새 게시글·댓글·대화 안전 분석/관리자 알림 검증이 남았다. iOS의 `APPLE_CLIENT_SECRET`과 Apple 공급자 설정도 별도 미완료다. [ADR-0001](../docs/decisions/0001-safety-monitoring-and-admin-access.md)의 전체 콘텐츠 분석·명시적 동의를 유지한다.
5. 소셜 앱에 추가로 요구되는 아동 안전 표준 선언은 공개 안전 정책 URL·담당 연락처·실제 대응 절차를 확인한 후 완료한다. 위 운영 검증 전에 준수 완료로 선언하지 않았다.

## 저장소와 되돌리기

대상은 기존 `dlwpdl/gling`의 `mobile-app`이다. 생성된 `android/`, AAB/APK, 업로드 키와 비밀번호는 커밋하지 않는다. 이 변경은 DB migration을 포함하지 않는다. 코드 롤백은 Android 등록 준비 커밋을 revert하고 동일 브랜치에 푸시한다. Play 초안은 콘솔에서 수정/폐기할 수 있으며 앱 등록 자체를 삭제할 필요는 없다.
