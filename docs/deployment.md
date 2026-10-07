# 무료 자동 배포

`dlwpdl/gling`은 공개 저장소이므로 표준 GitHub Actions의 Linux/macOS 빌드 시간은 무료입니다. EAS 클라우드 빌드 한도를 소비하지 않습니다. 유료 러너, Actions 캐시와 빌드 결과물 저장을 사용하지 않습니다. 저장소가 비공개로 바뀌면 모든 작업이 실행 전에 멈춥니다. 기존 Pages 배포의 결과물만 짧게 보관합니다.

`mobile-app` 코드 반영과 PR은 린트, 타입검사, 테스트, 웹 빌드를 검증합니다. 출시 버전 태그 `vX.Y.Z`를 올리면 검증 후 기존 인증서로 iOS/Android를 빌드합니다. 양쪽 스토어에서 쓰지 않은 동일한 빌드 번호를 자동으로 정합니다.

- iOS: App Store 심사 제출, 승인 후 출시, 기존 TestFlight 그룹 등록. Apple 심사 승인은 자동화할 수 없습니다.
- Android: Google Play **내부 테스트** 제출. 현재 계정의 프로덕션 출시 권한이 생기기 전에는 내부 테스트가 배포 대상입니다.
- Actions에서 **Free mobile release → Run workflow → mobile-app**을 선택하면 스토어에 제출하지 않고 서명 빌드만 검증합니다. 결과물은 러너 종료 때 삭제되며 해시와 제출 ID는 실행 기록에 남습니다.

## 다음 버전 출시

앱 코드를 `mobile-app`에 반영한 뒤 `app.json`의 `expo.version`, `package.json`, `package-lock.json`의 버전을 맞춥니다. `release-notes/X.Y.Z.ko.txt`를 작성하고 함께 커밋합니다. 이미 심사 중이거나 출시된 버전은 재제출하지 않습니다.

```sh
git push origin mobile-app
git tag v1.1.3
git push origin v1.1.3
```

태그가 `mobile-app`에 포함된 커밋인지와 소스 버전을 검사합니다. 릴리스 작업은 동시에 실행하지 않습니다. 실패 시 Actions에서 실패한 단계를 확인합니다. 이미 한 스토어가 제출을 받았다면 같은 태그를 무작정 다시 제출하지 말고 해당 스토어 상태를 먼저 확인합니다.

## 로컬 수동 경로

GitHub 장애·사용 제한이 있어도 기존 Mac/Xcode, Android SDK/Java, `asc` CLI로 무료 로컬 빌드와 수동 제출이 가능합니다. 보호된 기존 `credentials.json`과 `~/Library/Application Support/gling/credentials/`를 사용하며 저장소에는 올리지 않습니다. 로컬 환경의 `.env.local`/`.env.production`도 유지합니다.

```sh
python3 scripts/release.py prepare --tag v1.1.3 --local
# .release/state.json에 정해진 번호를 아래 55 대신 사용
python3 scripts/release.py build --platform ios --build-number 55 --local
python3 scripts/release.py submit --platform ios --local
python3 scripts/release.py build --platform android --build-number 55 --local
python3 scripts/release.py submit --platform android --local
```

`.release/app.ipa`는 기존 `asc publish appstore`로, `.release/app.aab`는 Play Console에서 직접 제출할 수도 있습니다. macOS 기본 Python의 인증서 저장소가 없으면 설치된 Python의 CA 인증서 경로를 `SSL_CERT_FILE`로 지정합니다. TLS 검증을 끄지 않습니다.

## 관리

GitHub Secrets: `GLING_ASC_JSON`, `GLING_PLAY_JSON`, `GLING_SIGNING_JSON`, `GLING_PUBLIC_ENV_JSON`. 기존 서명·스토어 자격 증명을 사용합니다. PR에는 서명과 스토어 비밀 정보를 전달하지 않습니다. 네이티브 빌드와 로컬 제출은 같은 스크립트를 사용합니다.

GitHub Actions 자체가 제한되면 유료 플랜을 켜지 않고 로컬 경로를 사용합니다. 개발자 계정의 기존 연회비 외에 추가 인프라 과금을 설정하지 않습니다. OTA 업데이트는 포함하지 않습니다. 현재 앱에는 `expo-updates`가 없어 별도의 네이티브 출시가 필요한 기능입니다.

기존 Orca 자동화·시간표·실행 소속을 확인했으며 별도의 Mac 예약 작업을 만들지 않습니다. 릴리스는 기존 스토어 제출 상태를 확인하고 하나의 GitHub 릴리스 큐에서 실행합니다. 이 경로는 GUI 없이 API로 제출합니다. Mac에서 브라우저를 통한 수동 제출이 필요하면 `/Users/ash/Desktop/Git/automation-coordination.md`의 기존 공용 `gui_bundle`을 사용하고 실제 제품·계정·페이지와 사용자 입력을 다시 확인합니다.

근거: [GitHub Actions 과금](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [표준 러너](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Google Play API 권한](https://developers.google.com/android-publisher/getting_started).
