# 무료 자동 배포

`dlwpdl/gling`은 공개 저장소이므로 표준 GitHub Actions의 Linux/macOS 빌드 시간은 무료입니다. EAS 클라우드 빌드 한도를 소비하지 않습니다. 유료 러너, Actions 캐시와 빌드 결과물 저장을 사용하지 않습니다. 저장소가 비공개로 바뀌면 모든 작업이 실행 전에 멈춥니다. 기존 Pages 배포의 결과물만 짧게 보관합니다.

`mobile-app` 코드 반영과 PR은 린트, 타입검사, 테스트, 웹 빌드를 검증합니다. 출시 버전 태그 `vX.Y.Z`를 올리면 검증 후 기존 인증서로 iOS/Android를 빌드합니다. 양쪽 스토어에서 쓰지 않은 동일한 빌드 번호를 자동으로 정합니다.

- iOS: App Store 심사 제출, 승인 후 출시, 기존 TestFlight 그룹 등록. Apple 심사 승인은 자동화할 수 없습니다.
- Android: Google Play **비공개 테스트(alpha)** 심사 제출. 현재 계정의 프로덕션 출시 권한이 생기기 전에는 비공개 테스트가 배포 대상입니다.
- Actions에서 **Free mobile release → Run workflow → mobile-app**을 선택하면 스토어에 제출하지 않고 서명 빌드만 검증합니다. 결과물은 러너 종료 때 삭제되며 해시와 제출 ID는 실행 기록에 남습니다.

## 다음 버전 출시

### 다음 배포에 포함할 알림 개선 — 2026-10-17

구현·로컬 검증을 마친 [알림 개선 묶음](../tasks/notification-quality-2026-10-17.md)을 다음 배포 소스에 포함합니다. 현재 배포 보류는 유지하며, 이후 명시적인 배포 지시가 있을 때 아래 항목을 함께 확인합니다. 앱 빌드만 올리면 서버 알림 변경은 적용되지 않습니다.

- [ ] 최종 배포 SHA에 `20261018020000_notification_quality.sql`, `supabase/functions/_shared/push-notifications.ts`와 관련 회귀 테스트가 모두 포함됐는지 확인합니다. 인기글은 실제 제목과 본문 미리보기를 보내며, 본문 앞의 중복 제목을 제거합니다.
- [ ] 기존 마이그레이션 적용 상태를 읽고 누락된 알림 마이그레이션을 순서대로 적용합니다. 선택 도시 제한, 행사 단위 중복 방지·예전 큐 식별값 복구, 문구 순환, 빈 추천 시간대 생략과 해시태그 푸시 제외가 서버 함수에 반영됐는지 재조회합니다.
- [ ] 기존 `push-notifications` Edge Function도 함께 배포하고, 이번 공유 전송 코드가 포함됐는지 확인합니다. DB 적용만으로 제목·본문 중복 제거가 배포된 것으로 처리하지 않습니다.
- [ ] 기존 수신 동의·현지 시간대·합산 하루 최대 8회와 메시지·답글·보안 알림을 확인합니다. 승인된 검증 기기에서 수신·표시·탭 목적지를 확인하고, 공급자 접수와 실제 휴대폰 수신을 구분해 기록합니다.

기존 일정·작업·최소 지원 버전은 이 묶음으로 바꾸지 않습니다. 서버 387개, 앱·푸시 62개 로컬 검사는 통과했으며 운영 적용과 실기기 확인은 아직 남아 있습니다.

### 공유 링크 단축과 업체 화면 보완 — 2026-10-17

[PR 보완 묶음](../tasks/pr-consolidation-2026-10-17.md)은 자동 배포를 실행하지 않는 통합 브랜치에 모은다. 배포 보류가 해제되면 기존 Vercel 미리보기 서버의 `/s/<22자 식별값>` 경로와 앱 사이트의 `share-redirect.js`를 먼저 배포·확인한 뒤, 짧은 링크를 생성하는 앱·웹을 공개한다. 새 경로가 없는 서버에 새 클라이언트만 먼저 공개하지 않는다. 기존 `/share/<UUID>` 링크의 미리보기·로그인 후 원문 이동도 함께 확인한다. 새 서비스·추적값·로그인 토큰은 사용하지 않는다.

업체 화면은 일시적 새로고침 실패 뒤 원고·사진 복원과 실제 권한 상실 시 자료 제거를 각각 확인한다. 관리자 분석·기기 내 번역·URI 보안은 이미 통합된 코드를 유지하며 오래된 PR을 다시 덮어쓰지 않는다.

### 비즈니스 작성자 개인정보 분리 — 2026-10-17

[비즈니스 공개 신원 명세](specs/business-public-identity-privacy-2026-10-17.md)의030/031/032/033/035/036 마이그레이션과 `public-post` Edge Function을 한 묶음으로 적용·확인합니다.032만 먼저 적용하지 않습니다. 새 클라이언트는036의 개인정보 보호 게시 경로를 요구하며, 이전 서버에서는 개인 계정 게시로 재시도하지 않고 중단합니다. 공개 화면·검색·개인 작성글·사진 경로의 분리와 비공개 관리자 신고/실제 작성자 접근을 함께 확인합니다. 현재 로컬 검증만 완료했으며 서버 배포·스토어 제출·최소 지원 버전 변경은 보류합니다.

### 앱 버전과 스토어 제출

앱 코드를 `mobile-app`에 반영한 뒤 `app.json`의 `expo.version`, `package.json`, `package-lock.json`의 버전을 맞춥니다. `release-notes/X.Y.Z.ko.txt`를 작성하고 함께 커밋합니다. 이미 심사 중이거나 출시된 버전은 재제출하지 않습니다.

```sh
git push origin mobile-app
git tag v1.1.3
git push origin v1.1.3
```

태그가 `mobile-app`에 포함된 커밋인지와 소스 버전을 검사합니다. 릴리스 작업은 동시에 실행하지 않습니다. 실패 시 Actions에서 실패한 단계를 확인합니다. 이미 한 스토어가 제출을 받았다면 같은 태그를 무작정 다시 제출하지 말고 해당 스토어 상태를 먼저 확인합니다.

배포 전에 staged/unstaged/untracked 앱 소스와 원본 작업의 누락을 점검하고, 필요한 변경을 검증·커밋한 뒤 정확한 SHA에서 배포합니다. 비밀 정보와 원본 QA는 커밋하지 않습니다.

구버전 강제 업데이트는 **빌드 완료나 심사 제출 시점에 적용하지 않습니다.** 기존 `sync-policy` 작업이 15분 주기로 공개 상태를 확인합니다. iOS는 `READY_FOR_SALE` 상태와 캐나다 App Store의 공개 버전이 일치하고 연결된 빌드가 `VALID`일 때만 최소 허용 빌드를 올립니다. 승인됐어도 스토어의 공개 버전이 이전 버전이면 차단하지 않습니다. Android는 공개 production 트랙의 완료된 출시만 대상으로 하며 내부·비공개 테스트 제출은 차단 기준을 올리지 않습니다. 기준 변경은 원자적으로 처리하고 실제 서버 값을 다시 확인합니다. GitHub 예약 실행이 지연되면 공개 확인도 늦어질 수 있습니다.

## 로컬 수동 경로

GitHub 장애·사용 제한이 있어도 기존 Mac/Xcode, Android SDK/Java, `asc` CLI로 무료 로컬 빌드와 수동 제출이 가능합니다. 보호된 기존 `credentials.json`과 `~/Library/Application Support/gling/credentials/`를 사용하며 저장소에는 올리지 않습니다. 로컬 환경의 `.env.local`/`.env.production`도 유지합니다.

수동 빌드는 출시 태그의 별도 체크아웃에서 실행합니다. 빌드 명령은 `app.json`으로 생성된 `ios`/`android` 프로젝트를 다시 만들므로, 직접 수정한 네이티브 프로젝트와 섞지 않습니다. 아래 예시는 로컬에 `v1.1.3` 태그가 있는 경우입니다. 태그가 원격에만 있으면 먼저 `git fetch origin --tags`로 가져옵니다.

```sh
git -C /Users/ash/Desktop/Git/unknown/mobile worktree add --detach /private/tmp/gling-manual-1.1.3 v1.1.3
cd /private/tmp/gling-manual-1.1.3
cp /Users/ash/Desktop/Git/unknown/mobile/credentials.json .
cp /Users/ash/Desktop/Git/unknown/mobile/.env.local .
chmod 600 credentials.json .env.local
npm ci
export SSL_CERT_FILE=/opt/homebrew/etc/openssl@3/cert.pem
python3 scripts/release.py prepare --tag v1.1.3 --local
GLING_RELEASE_BUILD=$(python3 -c 'import json; print(json.load(open(".release/state.json"))["build"])')
python3 scripts/release.py build --platform ios --build-number "$GLING_RELEASE_BUILD" --local
python3 scripts/release.py submit --platform ios --local
python3 scripts/release.py build --platform android --build-number "$GLING_RELEASE_BUILD" --local
python3 scripts/release.py submit --platform android --local
```

`.release/app.ipa`는 기존 `asc publish appstore`로, `.release/app.aab`는 Play Console에서 직접 제출할 수도 있습니다. macOS 기본 Python의 인증서 저장소가 없으면 설치된 Python의 CA 인증서 경로를 `SSL_CERT_FILE`로 지정합니다. TLS 검증을 끄지 않습니다.

## 관리

GitHub Secrets: `GLING_ASC_JSON`, `GLING_PLAY_JSON`, `GLING_SIGNING_JSON`, `GLING_PUBLIC_ENV_JSON`. 기존 서명·스토어 자격 증명을 사용합니다. PR에는 서명과 스토어 비밀 정보를 전달하지 않습니다. 네이티브 빌드와 로컬 제출은 같은 스크립트를 사용합니다.

Google Play의 기존 서비스 계정에는 글링 앱의 **앱을 테스트 트랙으로 출시** 권한을 추가했습니다. 저장된 권한과 내부 트랙 출시 검증 API를 확인했습니다. 프로덕션·관리자 권한은 추가하지 않았습니다.

GitHub Actions 자체가 제한되면 유료 플랜을 켜지 않고 로컬 경로를 사용합니다. 개발자 계정의 기존 연회비 외에 추가 인프라 과금을 설정하지 않습니다. OTA 업데이트는 포함하지 않습니다. 현재 앱에는 `expo-updates`가 없어 별도의 네이티브 출시가 필요한 기능입니다.

기존 Orca 자동화·시간표·실행 소속을 확인했으며 별도의 Mac 예약 작업을 만들지 않습니다. 릴리스는 기존 스토어 제출 상태를 확인하고 하나의 GitHub 릴리스 큐에서 실행합니다. 이 경로는 GUI 없이 API로 제출합니다. Mac에서 브라우저를 통한 수동 제출이 필요하면 `/Users/ash/Desktop/Git/automation-coordination.md`의 기존 공용 `gui_bundle`을 사용하고 실제 제품·계정·페이지와 사용자 입력을 다시 확인합니다.

근거: [GitHub Actions 과금](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [표준 러너](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Google Play API 권한](https://developers.google.com/android-publisher/getting_started).
