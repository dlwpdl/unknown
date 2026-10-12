# 필수 앱 업데이트

2026-10-12 사용자 지시: 버전이나 빌드가 새로 출시되면 해당 플랫폼의 구버전 사용자는 업데이트해야 앱을 사용할 수 있다.

기존 `AppUpdateGate`와 `app_release_policy.minimum_build`를 사용한다. 새 버전을 만들 때 iOS와 Android의 빌드 번호는 두 스토어의 이전 번호보다 크게 배정하므로 버전 변경과 빌드 변경 모두 이 기준으로 판별한다. 앱은 시작할 때와 백그라운드에서 돌아올 때 기준을 확인한다. 기준보다 낮으면 업데이트 화면을 표시한다. 조회에 실패하면 재시도 화면을 표시한다. 웹과 Expo Go는 대상이 아니다.

## 출시 확인과 자동 적용

기존 `mobile-release.yml`에서 15분마다 `python3 scripts/release.py sync-policy`를 실행한다. 수동 확인은 같은 워크플로의 `operation: sync-policy`로 실행한다. 이 경로는 빌드·심사 신청·스토어 발행을 하지 않는다.

- iOS는 캐나다 공개 App Store의 버전과 App Store Connect의 출시 완료 버전·연결된 VALID 빌드가 일치할 때 적용한다.
- Android는 Google Play production 트랙에서 전체 출시가 완료된 빌드만 적용한다. internal 테스트나 심사 중·부분 출시 빌드는 기준으로 올리지 않는다.
- 플랫폼별 기준은 원자적으로 올리며, 이전 결과를 읽어도 낮추지 않는다. 적용 뒤 운영 값을 다시 조회해 확인한다. 스토어 조회 실패는 성공으로 처리하지 않는다.

설치할 수 있는 새 빌드가 확인된 뒤 차단하므로, 업데이트 버튼을 눌러도 설치할 수 없는 상태를 만들지 않는다. 미래 출시에도 같은 절차를 적용한다. 확인 작업은 별도 GitHub 실행 그룹을 써서 기존 릴리스 대기열을 취소하지 않는다. 진행 중이거나 대기 중인 네이티브 릴리스가 있으면 스토어 조회를 다음 회차로 넘겨, Google Play의 열린 제출 edit도 건드리지 않는다.

## 검증과 자격증명

`node --experimental-strip-types --test scripts/release.test.mjs scripts/app-update.test.mjs scripts/festival-daily.test.mjs`로 공개 버전 불일치, 심사 중 빌드, internal/부분 출시 제외, 기준 하향 방지, 반복 적용을 검증한다. `npm run lint -- --no-cache`, `npm run typecheck`, `npm test`와 기존 CI를 통과한 뒤 적용한다.

스토어 인증은 기존 `GLING_ASC_JSON`·`GLING_PLAY_JSON`을 재사용한다. `GLING_SUPABASE_SERVICE_ROLE_KEY`는 기준 확인 작업에만 전달하며, 앱 빌드의 공개 환경이나 로그에 넣지 않는다. 프로젝트는 기존 `wjvahbdwmctzpkndqaxa`로 고정한다. 로컬 실행은 `python3 scripts/release.py sync-policy --local`이며 기존 키체인과 프로젝트 키를 사용한다.

이미 공개된 iOS 1.1.9(61)의 기준을 2026-10-12 운영에 적용했다. 복구가 필요하면 해당 작업의 `output/qa/mandatory-app-updates-2026-10-12/rollback.sql`을 사용한다. 자동 확인을 잠시 중지할 때는 기존 워크플로의 schedule 분기만 중지한다.

차단 코드가 없는 1.0.3 이하 바이너리에 새 화면을 소급해서 넣을 수는 없다. 이 확인 코드가 포함된 앱부터 강제 업데이트가 동작한다.
