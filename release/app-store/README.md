# App Store 화면 자료

`ios-6.9/`의 PNG 3장은 2026-09-06에 iPhone 16 Pro Max / iOS 18.4 시뮬레이터에서 실행한 실제 iOS Release 1.0.0 (1) 화면입니다. 각각 1320×2868 픽셀이며 이미지 편집이나 가상 UI 합성을 하지 않았습니다.

1. `01-vancouver.png`: 밴쿠버 피드와 모임 카드
2. `02-toronto.png`: 토론토 피드
3. `03-cities.png`: 운영 중인 도시와 준비 중인 도시

App Store Connect의 한국어 6.9인치 슬롯에 위 순서로 3장 업로드했으며, 6.5인치 슬롯도 이 자료를 사용하도록 표시됩니다.

화면의 예시 게시글 표기를 유지했습니다. 로그인 없이 피드·지역 선택을 확인했고, 상세 글 탭 시 로그인 안내와 둘러보기 복귀를 확인했습니다. Apple/Kakao 인증 완료나 로그인 이후 흐름은 이 자료의 검증 범위에 포함되지 않습니다.

재현: [출시 기록](../../tasks/release-status-2026-09-06.md)의 Release 빌드를 시뮬레이터에 설치하고 `xcrun simctl io <device-udid> screenshot <path.png>`로 저장합니다. 첫 화면의 글쓰기 탭이 정상 크기로 표시되는지도 확인합니다.
