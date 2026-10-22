# 게시글 URL·SNS 첨부와 링크 점검

2026-10-09 적용 승인: 사용자가 작은 Instagram 링크 시안을 확인하고 “좋다 적용해”라고 요청했다. 승인된 첨부 흐름을 앱 글 작성·수정과 소상공인 원고 편집에 연결하고, 공용 게시글·공개 웹·공유 HTML에도 같은 아이콘·계정명 표시를 적용한다. 기존 본문의 읽기 쉬운 `첨부 링크` 블록을 재사용해 새 DB 필드나 SNS 로그인 없이 저장·재조회한다. 지도·사진 출처와 일반 본문은 보존한다. 실제 악성 URL 조회 서비스는 설정되지 않았으므로 형식 차단과 `악성 여부 미확인`·이동 전 목적지 확인을 적용하며 안전 판정을 만들지 않는다. 기존 서버 전체 콘텐츠 모니터링과 저장 권한은 유지한다.

2026-10-09 후속 디자인: 사용자가 Instagram 링크 버튼이 너무 크므로 작고 단순하게 표시하고 Mobbin MCP를 참고하라고 요청했다. 실제 [Instagram 프로필의 작은 SNS 아이콘·계정명 한 줄](https://mobbin.com/screens/fd46bbb4-f06b-4ef9-83aa-461daa667c15)을 확인했다. Instagram 첨부의 큰 카드 배경·테두리·40px 아이콘·도메인 보조 줄·외부 이동 화살표·반복 안내 문장을 제거하고 18px 아이콘과 14px 계정명으로 표시한다. 실제 href·공식 호스트 검증·전체 아이디와 목적지를 읽는 접근성 이름·누름 피드백·44px 터치 높이는 유지한다. 일반 URL의 악성 여부 미확인 표시와 확인 시트는 보존한다.

2026-10-09 최초 시안: 사용자의 “시안줘바” 요청에 따라 기존 사진 10장·본문 링크 검증을 보존하는 클릭 가능한 HTML을 먼저 전달했다. 당시에는 앱·서버를 변경하지 않았으며, 후속 적용 승인을 받아 아래 앱 구현을 완료했다.

## 목표와 수용 기준

- `첨부 → URL 링크 / SNS → Instagram → 프로필 URL 입력 → 미리보기 → 첨부`. Instagram은 실제 공식 호스트의 프로필 경로에서 `@아이디`를 추출하고 작은 아이콘·아이디 한 줄로 보여준다. 전체 목적지는 접근성 이름과 링크의 실제 href로 유지한다.
- 계정 로그인·OAuth·계정 소유 인증으로 표현하지 않는다. 게시물·릴스·로그인 페이지와 가짜 Instagram 호스트는 프로필 첨부로 받지 않는다. 추적 쿼리·fragment는 프로필의 정규 URL에서 제거한다.
- 본문 URL도 같은 검증을 거친다. 기존 공용 `safePostLink`를 재사용하여 HTTPS·호스트·인증정보·단축주소·제어문자 정책을 유지한다. 차단된 주소는 활성 링크가 되지 않는다.
- 일반 HTTPS URL의 형식 통과는 악성 여부의 증명이 아니다. 실제 위협 목록 조회가 연결되기 전에는 `악성 여부 미확인`으로 표시한다. 이동 전 실제 목적지를 보여준다. 검사 실패·시간 초과·미설정을 안전 결과로 처리하지 않는다.
- 첨부 추가·삭제·중복 방지·취소·미리보기 저장·수정 복귀를 확인한다. 취소는 기존 본문·첨부를 보존한다. 44px 터치 영역·키보드 포커스·Escape·감소된 모션·각 컨트롤의 `useInteractionFeedback().play(...)`를 유지한다.

## 현재 범위와 경계

시안: `output/design/gling-link-attachments-2026-10-09.html`, 빠른 파일 경로 전달용 `../gling-link-preview.html`. 검증: `scripts/post-link-attachments-preview.test.mjs`, 기존 `scripts/post-links.test.mjs`, 실제 브라우저에서 작성·첨부·수정·삭제·외부 링크 목적지 검사.

앱 적용: 실제 작성 폼인 `src/components/feed-screen.tsx`, `post-detail.tsx`, `merchant-workspace.tsx`에 공용 `PostBodyEditor`를 연결했다. `PostBody`, 공개 웹 reader, `public-post` 공유 HTML은 같은 파서와 Instagram URL·아이콘을 사용한다. 기존 저장 API·DB 필드·권한은 변경하지 않았다. 첨부는 본문의 `첨부 링크` 블록에 저장하고 편집 시 본문에서 분리한다. 지도와 사진 출처를 보존하며 AI 본문 다듬기에도 첨부를 유지한다.

실제 위협 조회는 Google Web Risk Lookup API 등 상업용 계약을 확인한 서비스가 필요하다. 클라이언트에 키를 넣거나 사용자 URL을 직접 fetch하지 않는다. 연결 시 서버 인증·요청 수 제한·캐시/검사 시각·timeout·오류 구분과 앱/공유 페이지의 차단 상태가 필요하다. 이번 적용에서는 계정 생성·유료 호출·새 일정·외부 공개·DB 변경·배포를 실행하지 않았다.

## 최초 시안 구현과 검사

1. URL/프로필 공격·중복·잘못된 경로 테스트를 먼저 실패시키고, 실제 기존 URL 정책을 삽입한 자급형 HTML을 만든다.
2. URL/SNS 시트와 아이콘 카드·본문 검사·미리보기 저장/수정 흐름을 연결한다. 사용자 입력은 textContent로 렌더하고 정규화한 URL만 href에 넣는다.
3. `node --experimental-strip-types --test scripts/post-link-attachments-preview.test.mjs scripts/post-links.test.mjs`; 설치된 Playwright로 320/390/768px·키보드·취소·실제 href·JS 오류·실패 상태를 확인한다. OS 화면은 기존 공용 GUI guard로 검증한다.

## 디자인 근거와 실제 확인 범위

현재 BrandKit 색상은 앱 night/iris와 일치한다. Apple Design의 즉시 피드백·예측 가능한 단계·사용자 제어 원칙을 적용한다. Mobbin 실제 이미지에서 [Instagram URL 입력](https://mobbin.com/screens/b5a53165-1b52-4919-8c9b-a8d80eb27d25)과 [링크 시트](https://mobbin.com/screens/3eed790e-3395-47d3-8fdc-424230a879fd)의 명확한 URL 필드·취소/완료·입력 중 미리보기를 확인했다. 표시 이름으로 실제 목적지를 숨기지 않는다. Pinterest 검색은 실시했으나 해당 이미지 미관찰로 디자인 근거에 사용하지 않았다. Kroma는 API key 미설정으로 결과를 받지 못했다.

공식 자료: Expo 57 https://docs.expo.dev/versions/v57.0.0/ (확인), Safe Browsing https://developers.google.com/safe-browsing/v4 (비상업용 제한·v4 deprecated 확인), Web Risk https://cloud.google.com/web-risk/docs/overview . 위협 API 설정/조회 성공과 실제 출시·게시·사용자 안전 성과는 별도다.

2026-10-09 검증: 기존 URL 정책과 시안 모델 8개 Node 테스트 통과. 실제 Chromium 320/390/768px에서 첨부·URL/프로필 검증·중복·삭제·취소 복구·미리보기 저장·본문 링크·외부 이동 전 목적지 확인·Escape·모달 아래 폼 비활성·44px 컨트롤·가로 넘침0·JS 오류0을 확인했다. 외부 요청은 테스트 브라우저에서 차단해 실제 전송0. HTML은 자체 포함 파일이며 새 라이브러리·실제 서버 검사·DB·배포·계정 로그인·외부 게시는 실행하지 않았다. 브라우저 체크 재실행: 저장소 상위에서 `python3 mobile/scripts/check-link-attachments-preview.py` (현재 Playwright가 설치된 Python 환경 사용).

## 앱 적용 검증 · 2026-10-09

- `npm test`: 484개 중 483개 통과·실패 0·기존 merchant export 검사 1개 skip. 전체 결과는 `output/qa/post-link-attachments-2026-10-09/npm-test.log`에 저장했다.
- `npx tsc --noEmit`, 변경 파일 ESLint, 실제 Expo 웹 export 39개 경로 모두 통과했다. 설치된 의존성을 재사용하며 새 패키지는 추가하지 않았다.
- 실제 앱 컴포넌트와 실제 공유 HTML 핸들러 결과를 Chromium 320/390/768px에서 검사했다. 첨부·중복 방지·삭제·취소·로컬 저장 미리보기·키보드·외부 이동 확인이 통과했다. Instagram은 18px 아이콘·14px 계정명·44px 터치 높이를 유지한다. 가로 넘침과 JS 오류는 0이며 외부 요청 전송도 0이다.
- 붙여넣은 첨부가 사라지는 경우, 링크만 남은 글의 저장 시 trim 이후 재조회, 공유 HTML의 목적지 확인 누락을 회귀 테스트에서 먼저 재현하고 수정했다. 일반 공유 링크는 스크립트 없는 `details`로 목적지·미확인 안내를 펼친 후 별도 이동한다. 기존 CSP를 유지했다. 재검토 결과 해당 경로에 남은 Important 이슈는 없었다.

실제 컴포넌트 브라우저 검사는 저장소 상위에서 `python3 mobile/scripts/check-post-link-editor.py`로 실행한다. QA 번들을 먼저 빌드해야 하며 결과·화면·웹 빌드는 `output/qa/post-link-attachments-2026-10-09/`에 있다. 링크 모델·보안·지도 회귀 검사는 `node --experimental-strip-types --test scripts/post-link-attachments.test.mjs scripts/post-links.test.mjs scripts/post-maps.test.mjs`로 실행한다.

검증 경계: 실기기·운영 서버 저장·배포된 공유 페이지는 확인하지 않았다. 실제 악성 사이트 DB 조회·SNS 로그인·스토어 및 웹 배포는 실행하지 않았다. 일반 URL은 악성 여부 미확인 상태이며 형식 검증을 안전 판정으로 표현하지 않는다.
