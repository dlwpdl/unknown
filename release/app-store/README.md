# App Store 화면 자료

`ios-6.9/`의 PNG 3장은 2026-09-09에 iPhone 16 Pro Max / iOS 26.5에서 실행한 실제 iOS Release `1.0.0 (6)` 화면이다. 모두 1320×2868 픽셀이며 편집·가상 UI 합성 없이 `simctl io screenshot`으로 저장했다.

1. `01-vancouver.png`: 밴쿠버 피드, 검색 옆 프로필과 기본 iOS 탭 바
2. `02-toronto.png`: 도시 전환 후 토론토 피드
3. `03-cities.png`: 준비 중인 도시에만 상태를 표시하는 선택 화면

한국어 `APP_IPHONE_67` 슬롯에 새 3장을 먼저 업로드했다. 모두 `COMPLETE`이고 원격 체크섬과 로컬 MD5가 일치함을 확인한 뒤 이전 3장을 삭제했다. 최종 원격 목록도 위 순서의 3장이다. 화면에 포함된 글과 참가 수는 시드 데이터이며 실제 사용자 활동을 증명하는 자료가 아니다.

## 현재 배포 상태

App Store Connect 앱 `6809273242`의 1.0.0 버전에 빌드 6(`27cef51f-ac69-4ff8-bed3-76a94781dc76`)을 연결했고 한국어 What to Test를 저장했다. 제출 점검은 오류·경고 0이며 수동 출시의 `PREPARE_FOR_SUBMISSION` 상태다. 공개 심사 제출·출시는 아직 하지 않았다.

심사 로그인은 상단 검색 오른쪽 사람 아이콘 → `심사용 계정 로그인 / Review access`로 안내한다. 실제 자격 증명은 원격 심사 정보와 로컬의 보호된 자격 증명 파일에만 저장한다. 앱은 일반 사용자에게 카카오/Apple 로그인을 제공하며 공개 이메일 가입은 허용하지 않는다.

App Privacy 게시, 연령 설문, 심사 연락처와 CAN/USA/KOR 배포 국가 설정은 기존 작업에서 저장했다. 현재 CLI 공개 API는 App Privacy 상태를 직접 검증하지 못한다. 실제 개인 소셜 인증·탈퇴와 최종 운영 확인은 [후속 기록](../../tasks/release-followup-2026-09-09.md)을 따른다.

## App Store Connect CLI 5.0.0

설치된 `asc`의 키체인 프로필 `gling`을 사용한다. API 키 원본과 비밀번호는 Git에 넣지 않는다. 메타데이터의 한국어 locale은 `ko`다.

```sh
asc metadata validate --dir release/app-store/metadata --check-urls
asc --profile gling status --app 6809273242
asc --profile gling validate --app 6809273242 --version 1.0.0 --platform IOS --check-urls
asc --profile gling screenshots list --version-localization 94d258e7-d09b-4b3e-a002-7032e409b750
```

원본 아카이브와 설치 파일은 `~/Library/Application Support/gling/releases/1.0.0-6/`에 보관한다. iPhone X(iOS 16.7.14) 설치는 완료했으며 잠금을 푼 실기기 실행 확인은 남아 있다.

이전 빌드의 작업 내역: [빌드 2](../../tasks/store-update-2026-09-07.md), [빌드 4](../../tasks/release-followup-2026-09-08.md). 명령은 설치된 CLI의 `--help`와 [공식 프로젝트](https://github.com/rorkai/App-Store-Connect-CLI)를 기준으로 한다.
