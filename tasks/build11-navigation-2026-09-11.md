# 글링 1.0.0 (11): 화면 전환과 돌아가기

채팅/모임의 자리 안내에서 멤버십으로 바로 진입하면 중첩 프로필 Stack의 첫 화면이 되어 기본 뒤로가기가 사라졌다. 프로필 공통 헤더에 44pt 뒤로가기를 제공하고, 기록이 있으면 이전 화면으로, 없으면 프로필과 홈으로 돌아간다. 기존 푸터 모양은 유지한다.

| 점검 경로 | 변경 |
| --- | --- |
| 오늘·모임·채팅·알림 | 네이티브 콘텐츠에 200ms 전환. 빠른 탭 이동 시 중단·복원하고 동작 줄이기를 존중한다. 기존 웹 TabSlot 전환과 중복하지 않는다. |
| 오늘/모임 글 상세·채팅방·저장 목록 | 기존 네이티브 slide를 유지하고 iOS 끌어내려 닫기를 연결한다. |
| 검색 → 글 상세 | iOS 검색 모달의 onDismiss 후 상세/로그인을 열어 동시에 표시하는 충돌을 피한다. |
| 내 모임 열기 | 조회 대기 중 해당 카드에 로딩과 접근성 busy 상태를 표시한다. |
| 프로필·멤버십·설정·이용 수칙 | 공통 뒤로가기와 동작 줄이기 설정. 로그아웃의 이전 기록이 없는 경우 홈으로 복귀한다. |
| 공유 글 링크 | 불러오기·오류·삭제 상태에도 돌아가기 제공. 이전 글의 늦은 응답이 현재 화면을 덮지 않는다. |
| 인증 콜백·심사 로그인 | 콜백의 돌아가기와 심사 로그인 닫기의 이전 경로 복귀를 제공한다. |
| 검색·글쓰기·로그인·온보딩 | 각 전체 화면 모달의 안전영역 기준을 분리해 상태바와 버튼의 겹침을 해결한다. 필수 동의·잠금 계정 정책은 유지한다. |

검증: JS 검사 80개, typecheck, lint, 공개 웹 export 및 관리자 코드 제외 검사 통과. iOS 26.5 Release Simulator에서 채팅→멤버십→채팅, 오늘→글 상세→닫기, 검색→콜하버 글 상세→닫기, 글쓰기 상단 안전영역을 확인했다. 녹화 프레임에서도 상세 화면이 아래에서 올라오는 중간 상태를 확인했다. iPhone X와 Android의 실제 터치 재검증은 별도이며, 이번 확인을 실기기 검사로 간주하지 않는다.

- [멤버십 뒤로가기](../output/design/gling-navigation-build11/membership-back.png)
- [글쓰기 안전영역](../output/design/gling-navigation-build11/compose-safearea.png)
- [검색 결과에서 연 글](../output/design/gling-navigation-build11/search-detail.png)

iOS: 빌드 `83bef489-7bc7-4feb-a2f6-147ae965f20b`, 내부 그룹 `03fefab3-98b9-4f9c-a6a0-450fdd703efb`, IN_BETA_TESTING 확인. IPA SHA-256 `ba72499209e53b4b0eaf00a20d860aaf5afa3a91e976452ca2ad8122ec0d09d3`.

Android: 서명된 AAB 빌드와 서명 검사 완료. SHA-256 `b991057933b3fc04b7787007184138495ddb90aed03fe1d6f7aa2b66c0ff40f0`. 9월 11일 오후 3시 Play Console 내부 테스트 트랙에서 최신 버전 11, «내부 테스터에게 제공됨»을 확인했다. 가독화 파일 경고 1개가 있으며 출시를 차단하는 오류는 없었다. 계좌 확인용 입금 대기는 사용자가 확인 중이며 결제 계좌 설정은 변경하지 않았다. 양쪽 모두 내부 테스트 배포이며 정식 출시 심사 승인과는 별개다.

디자인 참고: 설치된 apple-design / frontend-ui-engineering, BrandKit 모션 토큰, Mobbin [Handshake 글 상세](https://mobbin.com/flows/0eb021f2-221c-4f1a-9c2f-393583991aae)와 [MasterClass 글 보기](https://mobbin.com/flows/716b4015-aa37-4700-b1ed-385c0cbe752c). Mobbin 정지 화면에서 애니메이션 시간을 추정하지 않았다. 구현은 [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/)와 [모달 SafeAreaProvider 안내](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/)를 확인했다. Kroma 검색은 연결된 검색 키 부재로 사용할 수 없었다.
