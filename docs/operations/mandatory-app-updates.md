# 필수 앱 업데이트

릴리스는 새 앱의 배포 상태와 이전 버전 차단까지 확인해야 끝난다. 사용자가 2026-10-14 이 순서를 다시 확인했다.

현재 `mobile-release.yml`과 `scripts/release.py sync-policy`는 **해당 플랫폼에서 공개 설치할 수 있는 새 빌드를 확인한 뒤** `app_release_policy.minimum_build`를 올린다. 빌드 성공, 업로드와 심사 접수만으로 기준을 올리지 않는다. 과거의 빌드 직후 차단 지침과 `require-update` 명령 설명은 현재 구현에 적용하지 않는다.

## 배포 및 차단 확인 순서

1. 배포할 소스, 버전과 실제 배정된 네이티브 빌드 번호를 고정하고 테스트·서명·스토어 제출 결과를 기록한다.
2. iOS는 캐나다 공개 App Store의 버전이 App Store Connect의 출시 완료 버전과 일치하고, 연결된 빌드가 VALID인지 확인한다.
3. Android는 Google Play production 트랙의 전체 출시 완료 빌드를 확인한다. 현재 비공개 alpha 테스트 제출은 공개 production 배포와 구분하며, 테스트 제출만으로 공개 사용자의 기준을 올리지 않는다.
4. 기존 워크플로의 `operation: sync-policy` 또는 정상 예약 회차로 플랫폼별 기준을 적용하고 운영 값을 다시 읽는다.
5. 기준보다 낮은 앱은 업데이트 화면을, 새 앱은 정상 진입을 확인한다. 시작과 백그라운드 복귀, 스토어 링크와 정책 조회 실패 시 재시도도 점검한다.

## 기존 자동 확인

기존 `mobile-release.yml`이 15분마다 `python3 scripts/release.py sync-policy`를 실행한다. 이 분기는 새 앱 빌드나 제출을 만들지 않는다. 별도 실행 그룹을 쓰며, 네이티브 릴리스가 진행 중이면 Google Play 제출 edit을 건드리지 않고 다음 회차로 넘긴다. 자동 갱신은 기준을 원자적으로 올리고 저장 결과를 다시 조회하며, 오래된 결과로 높은 기준을 낮추지 않는다.

현재 사용 중인 `AppUpdateGate`는 시작과 백그라운드 복귀 때 네이티브 빌드를 비교한다. 기준보다 낮으면 앱을 업데이트 화면으로 가리고, 정책 조회에 실패하면 재시도 화면을 보여준다. 웹과 Expo Go는 대상이 아니다. 확인 코드가 없는 1.0.3 이하 바이너리에 새 화면을 소급해서 넣을 수는 없다.

## 검증과 복구

`node --experimental-strip-types --test scripts/release.test.mjs scripts/app-update.test.mjs scripts/festival-daily.test.mjs`로 공개 버전 불일치, 심사 중 빌드, 테스트·부분 출시 제외, 기준 하향 방지와 반복 적용을 검사한다. `npm run lint -- --no-cache`, `npm run typecheck`, `npm test`와 기존 CI도 통과해야 한다.

스토어 인증은 기존 `GLING_ASC_JSON`·`GLING_PLAY_JSON`을 사용한다. 서비스 키는 정책 확인 작업에만 전달하며, 앱의 공개 환경이나 로그에는 넣지 않는다. 운영 프로젝트는 `wjvahbdwmctzpkndqaxa`로 고정한다. 로컬 명령은 `python3 scripts/release.py sync-policy --local`이다.

릴리스 전 플랫폼별 기존 기준을 보관한다. 복구할 때는 해당 릴리스가 올린 값인지 다시 확인하고, 다른 후속 릴리스의 기준을 덮어쓰지 않는다. 기존 복구 예시는 `output/qa/mandatory-app-updates-2026-10-12/rollback.sql`에 있다.

과거 기록: 2026-10-12 iOS 1.1.9(61)의 공개 빌드를 기준에 반영했고, 2026-10-13에는 당시 지시에 따라 iOS·Android 1.2.0(64)의 기준을 올렸다. 새 릴리스는 위의 현재 공개 설치 확인 절차를 따른다.
