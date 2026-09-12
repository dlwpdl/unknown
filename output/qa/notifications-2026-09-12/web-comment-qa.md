# 댓글 웹 시각 QA — 2026-09-12

2026-09-12 14:48–14:50 PDT, Orca 1.4.191의 Gling 폴더 새 탭에서 공개 Expo 웹 export를 실행했다. 아래 두 PNG를 직접 열어 확인했다.

- [390×844 기본 글자](web-comment-390.png): 알림에서 지정한 오래된 답글이 강조되고 같은 루트 댓글이 한 번만 보인다. 답글은 한 단계 들여쓰기이며 받는 사람 이름이 표시된다. 공감 3→4와 선택 색상도 확인했다.
- [320×740, 글자 180%](web-comment-320-text180.png): 답글 대상, 취소, 여러 줄 입력, 등록, 전송 실패 안내가 화면 폭 안에 배치된다. 입력 내용은 스크롤할 수 있다. 문서 가로 폭은 320px로 유지됐다.

두 번째 이미지는 DOM 글자 크기와 줄 높이를 1.8배로 바꾼 **브라우저 스트레스 검사**다. iOS Dynamic Type 또는 VoiceOver 검증을 대신하지 않는다. 기존 PostCard 하단 도구막대의 아이콘과 숫자는 이 조건에서 겹친다. 댓글 컨트롤에는 가로 넘침을 관찰하지 않았다. 이 기존 PostCard 문제는 통합 담당자에게 전달했다.

## 데이터와 번들 출처

- Export: `/tmp/gling-notifications-public-final`
- 실행 번들: `entry-e0b5f4563aa93d2b8c57bfbf01fcc471.js`
- 로컬 주소: `http://127.0.0.1:8189`
- Gling 폴더: `folder:e88d505b-f6bb-47d6-ba41-904ef2a72a8b`
- 임시 브라우저 탭: `502958fc-0226-4535-a350-64f588a1e420` — 검사 후 닫음. 다른 사용자 탭은 변경하지 않음.
- 설정 색상 후속 검사 탭 `57eb7888-ce92-4d78-a152-fb8f9fc82ebd`도 검사 후 닫음.
- Python 서버는 검사 후 종료했다.

`web-comment-mock.js`의 가짜 계정·게시물·댓글만 사용했다. 외부 fetch 응답을 로컬 모의 응답으로 대체하고 CSP `connect-src 'self'`로 외부 연결을 막았다. 실제 회원 데이터 작성, 실제 로그인, 푸시 발송은 수행하지 않았다. **이 기록은 실제 서버 알림 전달이나 DB 통합 성공의 증거가 아니다.**

## 확인한 동작

- `commentId=44444444-4444-4444-4444-444444444444`를 통해 루트와 정확한 답글을 불러왔다. 루트 본문은 DOM에 한 번만 존재했다.
- 답글 공감은 3→4로 바뀌고 `aria-pressed="true"`, 답글 펼침은 `aria-expanded="true"`를 노출했다. 모의 `comment_likes` 요청 대상도 지정 답글이었다.
- 다른 답글에 답글을 작성했을 때 모의 생성 RPC의 `p_reply_to_id`는 `43333333-3333-3333-3333-333333333333`이었다.
- 모의 HTTP 503에서 `role="alert"` 안내가 보였고 초안 `비가 와도 괜찮아요. 따뜻한 차를 챙겨 갈게요!`와 받는 사람이 유지됐다.
- 같은 초안을 재시도해 모의 성공 응답을 받으면 초안, 받는 사람, 오류 안내가 초기화됐다.
- 설정 화면의 태그 체크박스 `aria-checked`는 맞게 반영됐고 Switch는 네이티브 HTML input의 checked 상태를 노출했다. 켜진 Switch의 청록색 thumb를 담당자에게 보고한 뒤, 수정된 후속 번들 `entry-a12c795d190deecb25caee093e4e412b.js`에서 켜짐·꺼짐 모두 `theme.accentInk`인 `rgb(26, 14, 11)`로 바뀐 것을 DOM으로 확인했다. 설정 소스 `src/app/profile/notifications.tsx`의 이 시점 SHA256은 `25183c3f3185750399e78a0a99c9f33393f632d2fd64f92b20ea318a3058087d`다. 이 후속 export는 설정의 웹 thumb 속성만 변경하여 위 댓글 PNG의 출처 번들과 구분했다.

QA에서 발견한 댓글 수정은 `post-detail.tsx`의 웹 `aria-pressed`/`aria-expanded`와 웹 전송 오류 inline 안내다. 네이티브 오류 Alert는 유지했다. 해당 회귀는 `scripts/comment-threads.test.mjs`에 포함했다. 댓글·이동 관련 Node 검사 5개, TypeScript 검사, 해당 파일 ESLint가 통과했다.

## 재현

프로젝트 루트에서 기존 public export를 지정한다. 새 의존성은 필요 없다.

```sh
python3 output/qa/notifications-2026-09-12/web-comment-server.py \
  --export /tmp/gling-notifications-public-final --port 8189
```

새 브라우저 탭에서 다음 주소를 열고 viewport를 설정한다. Orca는 이동 후 viewport 설정이 필요할 수 있다.

```text
http://127.0.0.1:8189/post/41111111-1111-1111-1111-111111111111?commentId=44444444-4444-4444-4444-444444444444
```

기본 검사는 390×844에서 공감을 누른다. 실패 검사는 답글의 답글 버튼을 누르고 초안을 입력한 뒤 콘솔에서 `window.__commentQA.failSend = true`를 설정하고 등록을 누른다. `window.__commentQA.requests`에서 모의 요청을 확인할 수 있다. `false`로 되돌리면 재시도가 성공한다.

320×740에서 실패 안내까지 표시한 후 다음 코드를 한 번 실행하면 큰 글자 조건을 재현한다. 새로고침하면 원래 글자 크기로 돌아간다.

```js
for (const el of document.querySelectorAll('div,textarea,input,h1')) {
  if (el.matches('textarea,input') || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
    const style = getComputedStyle(el);
    el.style.fontSize = `${parseFloat(style.fontSize) * 1.8}px`;
    if (style.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(style.lineHeight) * 1.8}px`;
  }
}
```

검사 후 임시 탭을 닫고 서버에 Ctrl-C를 보낸다. 모의 계정 환경은 해당 localhost 테스트에만 사용한다.
