# 글링 피드와 탐색 변경

사용자가 승인한 범위: B안의 종이색·붉은 포인트를 유지하고 작은 글자와 좌우 16pt 여백, 왼쪽 반응 버튼과 중복 없는 조회수, 스크롤 방향에 반응하는 헤더를 적용한다. 하단 순서는 오늘·모임·글쓰기·채팅·알림, 내 프로필은 검색 오른쪽이다. 모임은 기존 모임 게시글·참여 흐름을 재사용한다.

구현 순서: 공통 글 카드 → 네이티브 sticky header와 기존 피드를 재사용하는 모임 탭 → 프로필/알림 경로와 하단 탭 → 빌드와 기기 확인. iOS 시스템 로그인 이름은 `CFBundleName`을 글링으로 명시한다. 로그인 도메인은 소유한 도메인과 인증 서버 설정이 마련되어야 변경할 수 있다.

검사: `npm run typecheck`, `npm run lint`, `npm test`, `node scripts/check-review-navigation.mjs <GLING_PAGE_ID>`, Expo 웹 export, iOS archive와 기기 설치. 네이티브에서 스크롤 방향 전환·헤더 버튼·다섯 탭·모임 참여·비로그인 알림 진입을 확인한다. Reduce Motion에서는 헤더를 고정하여 움직임을 줄이고 44pt 터치 영역을 유지한다.

소스는 기존 `src/components`, 경로는 `src/app`, 문구는 `src/i18n/ko.ts`를 사용한다. 예: `style={[styles.headRow, { backgroundColor: theme.background }]}`. 새 라이브러리·서버·광고 SDK는 추가하지 않는다. 광고는 `output/design/gling-feed-ad-placement.html`의 검토용 시안으로 둔다. 계정·동의·신고·안전 모니터링 권한을 그대로 보존한다.
