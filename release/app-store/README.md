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

저장소 루트에서 실행합니다. 첫 명령은 API 인증 없이도 실행할 수 있습니다.

```sh
asc metadata validate --dir release/app-store/metadata --check-urls
asc status --app 6809273242
asc metadata apply --app 6809273242 --version 1.0.0 --platform IOS --dir release/app-store/metadata --dry-run
asc validate --app 6809273242 --version 1.0.0 --platform IOS --check-urls
asc builds next-build-number --app 6809273242 --version 1.0.0 --platform IOS
```

현재 `asc auth status`에 API 키가 없고 `asc web auth status`도 미인증입니다. `asc status`는 인증 누락으로 종료 코드 3을 반환했습니다. 따라서 원격 상태 확인과 반영은 아직 수행하지 못했습니다. 브라우저 App Store Connect 로그인도 만료되어 소유자의 재로그인이 필요합니다.

로그인 후 [API 키 관리](https://appstoreconnect.apple.com/access/integrations/api)에서 사용할 키를 확인하고 `asc auth login --help`에 따라 macOS Keychain에 연결합니다. 키 파일과 인증 설정은 Git에 저장하지 않습니다. API 인증과 `asc web auth login`은 별개이며, 캐시된 CLI 웹 세션까지 연결되면 위 `asc validate` 명령에 `--deep`을 추가해 App Privacy와 계약 상태도 조회할 수 있습니다.

원격 상태를 확인한 뒤 `--dry-run`의 변경 내역을 검토하고 필요한 메타데이터만 반영합니다. 다음 네이티브 업로드는 조회한 새 빌드 번호를 사용해 `글링` 홈 화면 이름과 수출 규정 설정을 포함합니다. [출시 기록의 운영 필수 작업](../../tasks/release-status-2026-09-06.md#심사-제출-전-필수-작업)과 심사 연락처·개인정보·연령 등급 확인은 계속 남아 있습니다. 로컬 메타데이터 검증 통과는 심사 제출 준비 완료를 의미하지 않습니다.

명령 출처: 설치된 CLI의 `--help` 및 [CLI 프로젝트 문서](https://github.com/rorkai/App-Store-Connect-CLI).
