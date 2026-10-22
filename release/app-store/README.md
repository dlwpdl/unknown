# App Store 화면 자료

## 1.1.0 브랜드 아이콘 준비

심사용 1024×1024 불투명 RGB 아이콘은 [brand-1.1.0/icon-1024.png](brand-1.1.0/icon-1024.png), 앱 내 워드마크는 [brand-1.1.0/wordmark.png](brand-1.1.0/wordmark.png)다. 기존 스크린샷은 이전 디자인이므로 1.1.0 제출 전에 새 빌드의 실제 화면으로 다시 촬영한다.

## 2026-09-21 — 1.0.2 스크린샷 교체

사용자 요청으로 1.0.2(33) 심사를 회수했다. `DEVELOPER_REJECTED`(개발자가 취소함)를 API와 콘솔에서 확인했다. 현재 배포된 1.0.1은 그대로 유지된다.

`ios-6.9-build33/`는 현재 1.0.2 소스를 Release로 빌드하여 iOS 26.5의 GLING App Store 6.9 시뮬레이터에서 캡처한 1320×2868 PNG 6장이다. 앱 UI나 게시물·수치를 이미지 편집으로 변경하지 않았다. 상태 표시줄만 시뮬레이터 기능으로 9:41·배터리 100%로 설정했다. 위치 선택 검증에는 시뮬레이터의 밴쿠버 좌표를 사용했다.

후속 요청에 따라 2·3번은 **커버 사진을 넣은 러닝 모임 샘플**로 다시 촬영했다. AI 생성 커버는 `sample-assets/running-cover.png`에 보관한다. 기존 시드 모임의 ID에만 사진을 연결한 로컬 촬영용 복사본(`/tmp/gling-running-capture`)을 사용했다. 실제 앱의 사진 컴포넌트로 렌더링했으며 UI 합성, 운영 DB 수정, 공개 모임 생성은 하지 않았다. [샘플 자산 기록](sample-assets/README.md).

1. 오늘 피드
2. 정기 모임 탐색
3. 러닝 모임 상세와 참여
4. 글쓰기와 카테고리
5. 지역 선택(밴쿠버·토론토·에드먼튼)
6. 정착 키워드 검색

업로드 후 원격 6장 모두 `COMPLETE`, 로컬 MD5 일치, 위 순서를 확인한 다음 기존 3장을 삭제했다. 최종 6장만 남았고 1.0.2는 `DEVELOPER_REJECTED`, 연결 빌드는 33이다.

기존 두 도시의 유사한 피드 반복을 줄이고 실제 기능을 넓게 보여주는 구성이다. 예시 게시물·댓글·참가 수는 실제 사용자 성과의 증거가 아니다. 심사용 로그인과 비공개 계정 정보는 이미지에 포함하지 않았다. 앱 코드 변경이나 새 스토어 빌드 업로드는 하지 않았다. 스크린샷은 회수된 1.0.2에 반영하며 재심사는 아직 제출하지 않는다.


`ios-6.9/`의 PNG 3장은 2026-09-09에 iPhone 16 Pro Max / iOS 26.5에서 실행한 실제 iOS Release `1.0.0 (6)` 화면이다. 모두 1320×2868 픽셀이며 편집·가상 UI 합성 없이 `simctl io screenshot`으로 저장했다.

1. `01-vancouver.png`: 밴쿠버 피드, 검색 옆 프로필과 기본 iOS 탭 바
2. `02-toronto.png`: 도시 전환 후 토론토 피드
3. `03-cities.png`: 준비 중인 도시에만 상태를 표시하는 선택 화면

한국어 `APP_IPHONE_67` 슬롯에 새 3장을 먼저 업로드했다. 모두 `COMPLETE`이고 원격 체크섬과 로컬 MD5가 일치함을 확인한 뒤 이전 3장을 삭제했다. 최종 원격 목록도 위 순서의 3장이다. 화면에 포함된 글과 참가 수는 시드 데이터이며 실제 사용자 활동을 증명하는 자료가 아니다.

## 현재 배포 상태

2026-09-10 14:58 PDT에 App Store Connect 앱 `6809273242`의 1.0.0 빌드 6(`27cef51f-ac69-4ff8-bed3-76a94781dc76`)을 정식 심사에 제출했다. 브라우저 접수 완료 화면과 API에서 `WAITING_FOR_REVIEW`를 확인했다. 수동 출시 설정으로, 승인 후 자동 공개되지 않는다. [제출 기록](../../tasks/release-followup-2026-09-10.md).

2026-09-10 TestFlight 확인 당시 빌드 6은 `VALID` / `READY_FOR_BETA_TESTING`이었지만 그룹과 테스터가 모두 0이었다. `Gling Internal` 내부 그룹(`03fefab3-98b9-4f9c-a6a0-450fdd703efb`)을 만들고 빌드 6을 연결했으며 원격 관계를 재조회해 확인했다. 소유자 승인 후 계정 소유자를 테스터로 추가해 이메일 초대를 발송했고, 원격 `INVITED` 상태와 내부 그룹 연결을 확인했다. 빌드 업로드와 테스터 배포는 별도 단계이며, 초대 수락·실기기 설치는 아직 확인하지 않았다.

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
