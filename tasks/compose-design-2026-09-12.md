# 글쓰기 화면 정리 · 2026-09-12

기존 화면은 도시 버튼, GPS 안내, 사진/AI 카드, 카테고리, 해시태그가 제목보다 먼저 나와 입력 시작점이 화면 아래로 밀렸다. 도시 버튼에는 본문과 같은 좌우 여백도 없었다. `output/qa/compose-2026-09-12/before.png`는 변경 전 iOS 화면이다.

## 적용

- 글링의 종이색·먹색·인주색 토큰을 유지한다. iOS는 네이티브 pageSheet로 열고 상단에 닫기·남은 작성 수·올리기를 배치한다.
- 도시·카테고리는 짧은 선택 버튼으로 묶고 제목·본문을 먼저 보여준다. 카테고리와 해시태그는 필요할 때 펼친다. 사진 첨부와 기존 AI 초안 기능은 본문 아래에 둔다.
- 기존 CityPicker를 재사용한다. 작성 중 도시 선택은 해당 초안에만 적용하고 프로필 선호 지역을 저장하지 않는다. 작성 화면의 GPS 수집은 기존 동의·안전 기록 경로를 유지하되 선택한 게시 도시를 덮어쓰지 않는다.
- 글자 크기·테마를 바꿀 때 네이티브 텍스트 레이아웃을 다시 만들어 잘림과 색상 갱신 문제를 방지한다.
- 입력한 초안이 있으면 닫았다 다시 열어도 게시 도시를 유지한다. 신규 라이브러리나 DB 변경은 없다.

## 참고

[Apple Modality](https://developer.apple.com/design/human-interface-guidelines/modality), [Expo 57](https://docs.expo.dev/versions/v57.0.0/), [Threads 작성 화면](https://mobbin.com/screens/87614707-9bd9-4b71-8eb5-7a4ab54e03ad), [Locals 위치 선택](https://mobbin.com/screens/e587f61c-5755-4bd0-9e9d-1f02e32bfc40), [Pinterest 위치 선택 참고](https://www.pinterest.com/pin/464363411602946447/).

Apple Design 스킬을 적용하고 Mobbin/Pinterest 실제 이미지를 확인했다. BrandKit은 기본 템플릿만 있고 글링 자료가 없어 기존 코드 토큰을 기준으로 삼았다. Kroma는 SERPER_API_KEY가 없어 조사하지 못했다.

## 확인

- 도시 선택 회귀 검사: 게시 도시를 바꿔도 프로필 저장을 호출하지 않고 준비 중 도시는 선택할 수 없다. 기존 기능에서 먼저 실패한 뒤 수정 후 통과했다.
- 웹에서 제목·본문 입력, 도시·카테고리 변경 후 초안 유지, 모임 안내 표시, 추천 해시태그 추가, 유효한 입력에만 게시 버튼 활성화를 확인했다. 실제 게시·AI 호출은 하지 않았다.
- 네이티브 검증 결과는 `output/qa/compose-2026-09-12/verification.json`에 기록한다.
