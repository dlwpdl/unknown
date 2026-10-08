# 소상공인 AI 초안·게시 선택

사용자 승인: 2026-10-07 대화의 시안 확인 → “좋다” → “진행시켜”. 기존 Expo 앱의 소상공인 도구에 연결한다.

## 목표와 기준

- 이번 소식 한두 문장을 입력해야 AI 초안을 요청할 수 있다. 공백만 입력하면 클라이언트와 서버 모두 거절한다.
- 기존 `draft-post`의 인증·AI 동의·하루 5회 한도를 재사용한다. 서버의 업체 접근 권한 확인 뒤 가게 이름·도시만 문맥으로 전달한다. 연락처·재고·관리자 메모는 전달하지 않는다.
- 가게 소식 / 메뉴·서비스 소개 / 구인구직 목적에 맞춘 원고를 만들고, 가격·날짜·주소·방문 경험을 지어내지 않는다. 사용자 후속 지시: 가게를 대표하는 공손하고 친근한 존댓말을 사용한다. 일반 회원·사진·행사 모임의 기존 작성 지침은 유지한다.
- 생성 결과는 직접 수정한다. 오류·취소·계정 전환 시 이전 원고를 덮어쓰지 않는다. 기존 승인·최신 저장본 검사를 재사용한다.
- 새 원고는 글링 ON, 네이버·다음 OFF. 선택한 곳과 원고를 확인한 뒤 글링만 실제 게시한다. 카페는 자동 연결이 준비되기 전까지 원고 복사·직접 등록으로 표시한다.
- 초안 저장은 게시와 별개다. 게시 성공 후 같은 원고를 재게시하지 않는다. 기존 캐스모·헬로밴쿠버 저장 원고의 편집·복사·URL 기록은 유지한다.

## 구조와 스타일

`supabase/functions/draft-post/index.ts`: 소상공인 intent와 서버 문맥. `src/components/merchant-workspace.tsx`: 기존 편집기·폼·피드백·실행 잠금·원고 승인/게시 RPC를 재사용한다. 새 의존성·DB 변경·예약 자동화는 필요 없다.

현재 night/iris 테마, 시스템 글꼴, 44px 조작 영역, React Native Switch와 기존 `useInteractionFeedback().play(...)`를 사용한다. 단계마다 주 행동 하나, 사실 입력 → 편집 → 게시 채널 확인. 기존 스타일 예: `changeDraft({ title })`, `void run(async () => ..., '초안을 저장했어요.')`.

근거: Apple Design 스킬, [Buffer AI 입력·삽입](https://mobbin.com/screens/ff1e037e-1a9f-4bd3-8264-45189fe6ec0e), 승인된 `output/design/gling-merchant-ai-channels-2026-10-07.html`, 공식 Expo SDK57 문서.

## 순서와 검증

1. 서버 테스트부터 작성: 빈 내용·접근 거절은 AI/한도를 사용하지 않으며, 서버 업체 문맥만 전달한다. 소상공인 지침과 기존 intent의 분리를 확인한 뒤 서버 구현.
2. 기존 편집기에 목적·필수 설명·AI·채널 스위치·최종 확인을 연결. 제목/본문 저장·승인·게시 revision을 유지.
3. 실제 React 컴포넌트의 로컬 모의 서버로 입력 보존, 저장/게시 분리, OFF 채널, 실패·중복·계정 전환을 검증하고 화면을 확인.

명령:

```sh
node --experimental-strip-types --test scripts/merchant-ai-draft.test.mjs scripts/draft-post.test.mjs scripts/merchant-workspace.test.mjs
npm run typecheck
npm test
npx eslint src/components/merchant-workspace.tsx supabase/functions/draft-post/index.ts
npx expo export --platform web --output-dir output/qa/merchant-ai-implementation-2026-10-07/web-build
```

## 경계

항상: 입력 검증·권한·동의·비용 한도·승인 원고·계정/업체 분리·접근성·서버 안전 모니터링을 보존한다. AI 출력은 원고 데이터이며 자동으로 저장/게시하지 않는다.

이번 구현은 코드와 로컬 모의 검증이다. 유료 AI 실제 호출·실제 업체 글 게시·네이버 개발자 앱 등록·운영 배포·새 스토어 제출은 별도로 구분한다. 네이버 자동 연결에 필요한 개발자 앱 등록 여부는 사용자에게 확인 중이다. 키를 클라이언트나 문서에 저장하지 않는다.
