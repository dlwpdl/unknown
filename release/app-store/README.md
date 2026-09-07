# App Store 화면 자료

`ios-6.9/`의 PNG 3장은 2026-09-06에 iPhone 16 Pro Max / iOS 18.4 시뮬레이터에서 실행한 실제 iOS Release 1.0.0 (1) 화면입니다. 각각 1320×2868 픽셀이며 이미지 편집이나 가상 UI 합성을 하지 않았습니다.

1. `01-vancouver.png`: 밴쿠버 피드와 모임 카드
2. `02-toronto.png`: 토론토 피드
3. `03-cities.png`: 운영 중인 도시와 준비 중인 도시

App Store Connect의 한국어 6.9인치 슬롯에 위 순서로 3장 업로드했으며, 6.5인치 슬롯도 이 자료를 사용하도록 표시됩니다.

화면의 예시 게시글 표기를 유지했습니다. 로그인 없이 피드·지역 선택을 확인했고, 상세 글 탭 시 로그인 안내와 둘러보기 복귀를 확인했습니다. Apple/Kakao 인증 완료나 로그인 이후 흐름은 이 자료의 검증 범위에 포함되지 않습니다.

재현: [출시 기록](../../tasks/release-status-2026-09-06.md)의 Release 빌드를 시뮬레이터에 설치하고 `xcrun simctl io <device-udid> screenshot <path.png>`로 저장합니다. 첫 화면의 글쓰기 탭이 정상 크기로 표시되는지도 확인합니다.

## App Store Connect CLI 5.0.0

2026-09-07에 설치된 `asc 5.0.0`으로 기존 [한국어 메타데이터](../../tasks/app-store-metadata-ko-KR.md)를 `metadata/`의 JSON 2개로 옮겼습니다. CLI의 한국어 locale은 `ko`입니다. 문구와 공개 URL 검증 결과는 오류 0, 경고 0입니다. 빈 필드는 생략해 기존 원격 값을 지우지 않습니다.

저장소 루트에서 실행합니다. 첫 명령은 API 인증 없이도 실행할 수 있고, 원격 명령에는 키체인의 `gling` 프로필을 지정합니다.

```sh
asc metadata validate --dir release/app-store/metadata --check-urls
asc --profile gling status --app 6809273242
asc --profile gling metadata apply --app 6809273242 --version 1.0.0 --platform IOS --dir release/app-store/metadata --dry-run
asc --profile gling validate --app 6809273242 --version 1.0.0 --platform IOS --check-urls
asc --profile gling validate testflight --app 6809273242 --build-id b6712770-ae17-4267-90f0-37ab3bac8b39
asc --profile gling builds next-build-number --app 6809273242 --version 1.0.0 --platform IOS
```

소유자가 발급한 API 키를 2026-09-07에 macOS Keychain의 `gling` 프로필로 연결했습니다. `asc auth login --network`와 `asc auth doctor`가 통과했고 글링 앱의 실제 API 조회·수정을 검증했습니다. 다운로드한 원본 키는 소유자만 읽고 쓸 수 있도록 권한을 `0600`으로 제한했습니다. 키 본문은 Git과 문서에 저장하지 않습니다.

API 인증과 `asc web auth login`은 별개입니다. 현재 CLI 웹 세션은 없으며, App Privacy는 로그인된 브라우저의 [개인정보 페이지](https://appstoreconnect.apple.com/apps/6809273242/distribution/privacy)에서 확인했습니다. 개인정보 설문은 아직 시작 전입니다. 향후 CLI 웹 세션도 연결하면 `asc validate`에 `--deep`을 추가해 해당 상태를 함께 조회할 수 있습니다.

이번에 원격으로 저장하고 재조회한 항목:

- Rottery와 동일한 저작권 `2026 Eunsense Studio`, 사용자 콘텐츠와 약관의 사용 권한에 맞는 `USES_THIRD_PARTY_CONTENT` 선언.
- 무료 가격(CAD 0, 기준 지역 CAN). 실제 배포 국가는 별도 선택 대기입니다.
- 이름·부제와 중복된 검색 키워드 제거. 적용 후 메타데이터 차이는 0건입니다.
- TestFlight 심사 연락처와 한국어 테스트 안내. 이름·전화번호는 Rottery의 등록 정보를 재사용하고 이메일은 글링의 기존 지원 주소를 사용했습니다. 안내에는 인증 이후 기능과 안전 처리의 추가 검증 필요성을 명시했습니다.

`validate testflight`는 오류·경고 0입니다. 빌드 `1.0.0 (1)`은 `VALID`, 수출 규정 응답은 `usesNonExemptEncryption=false`이며 다음 빌드 번호는 `2`입니다. 이 결과는 테스터 배포나 외부 베타 심사 승인을 의미하지 않습니다. 앱은 계속 수동 출시의 `PREPARE_FOR_SUBMISSION` 상태입니다.

공개 심사 `validate`는 오류 26개, 경고 0개를 보고합니다: 연령 설문 미응답 24개, 심사 정보 미생성 1개, 배포 국가 미설정 1개입니다. Apple은 연령 설문의 부분 저장을 거절했고, CLI는 심사 로그인 필요 설정에 실제 사용자 이름·암호를 요구하므로 임의 응답이나 가짜 계정을 넣지 않았습니다. App Privacy 미작성과 운영 필수 검증은 이 오류 개수와 별개로 남습니다.

원격 상태를 확인한 뒤 `--dry-run`의 변경 내역을 검토하고 필요한 메타데이터만 반영합니다. 다음 네이티브 업로드는 조회한 새 빌드 번호를 사용해 `글링` 홈 화면 이름과 수출 규정 설정을 포함합니다. [출시 기록의 운영 필수 작업](../../tasks/release-status-2026-09-06.md#심사-제출-전-필수-작업)과 심사 연락처·개인정보·연령 등급 확인은 계속 남아 있습니다. 로컬 메타데이터 검증 통과는 심사 제출 준비 완료를 의미하지 않습니다.

명령 출처: 설치된 CLI의 `--help` 및 [CLI 프로젝트 문서](https://github.com/rorkai/App-Store-Connect-CLI).
