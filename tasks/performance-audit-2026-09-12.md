# 글링 성능 점검 — 2026-09-12

검토 시점 HEAD: `682d4bc`. 앱 코드·DB·서버 설정 변경 없이 소스와 로컬 모의 호출을 점검했다. 기본 피드 최적화는 있으나, 대규모 사용량을 견딘다는 검증은 아직 없다.

## 우선 보완 후보

1. **채팅 목록을 갱신할 때 전체 이력을 다시 조회한다.** `src/lib/community-data.ts:243`의 `loadConversations`는 50개씩 마지막 페이지까지 순차 조회한다. `src/app/(tabs)/chat.tsx:50`의 `refresh`가 이 함수를 호출하며, 74행의 메시지 INSERT 구독이 다시 갱신한다. 모의 RPC로 원본 함수를 실행한 결과, 대화 25/50/500/5,000개에서 각각 1/2/11/101번 호출했다. 화면에서 종료된 이력을 더 볼 때만 다음 페이지를 가져오고 현재 목록은 변경분만 갱신하는 것이 우선이다. 단순히 첫 50개로 잘라 활성 대화방을 숨기면 안 된다. 방 안에서도 새 메시지마다 최근 50개를 다시 조회한다(`src/components/chat-room.tsx:74`). 위 숫자는 네트워크 지연이나 실사용 계정 크기를 측정한 값이 아니다.

2. **댓글 화면은 더 읽은 항목이 계속 화면 트리에 쌓인다.** 댓글·대댓글은 30개씩 조회하고 답글은 펼칠 때만 요청하지만(`src/lib/comment-threads.ts:40`), 상세 화면은 `ScrollView` 안에서 읽은 모든 루트 댓글과 펼친 답글을 렌더링한다(`src/components/post-detail.tsx:432`, `:471`). 계속 더 보기를 누르면 화면 밖 항목도 유지된다. 기존 `FlatList`를 재사용하되 답글도 개별 행으로 가상화하고, 알림으로 특정 댓글 이동·입력 중 키보드·접기 상태를 보존하는 방향이 맞다. 실제 프레임 드롭은 측정하지 않았다. [React Native 0.86 공식 설명](https://reactnative.dev/docs/0.86/scrollview)은 긴 목록에서 `ScrollView`가 모든 자식 뷰를 만드는 비용을 설명한다.

3. **피드용 작은 이미지가 없다.** 선택 시 `quality: 0.7`, 파일 상한 5 MiB는 있지만 픽셀 크기 제한이나 별도 썸네일은 없다(`src/components/feed-screen.tsx:299`). 업로드한 파일의 서명 URL을 카드에도 그대로 사용한다(`src/lib/community-data.ts:104`, `src/lib/feed-data.ts:143`, `src/components/post-card.tsx:126`). 이미지가 많아지면 전송량이 늘 수 있다. 대표 기기에서 실제 업로드 크기·피드 전송량을 측정한 뒤 피드 표시 크기에 맞춘 축소를 적용한다. `expo-image`의 기본 디스크 캐시는 이미 있으므로 캐시가 전혀 없다고 판단하면 안 된다. URL 갱신 시 캐시 재사용 여부도 확인 대상이다. [Expo Image](https://docs.expo.dev/versions/v57.0.0/sdk/image/), [ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/).

4. **관심 주제 알림 생성이 글 저장에 묶여 있다.** `supabase/migrations/0040_comment_threads_notifications.sql:405`의 AFTER INSERT 트리거가 동의한 수신자별 알림을 같은 트랜잭션에서 생성한다. 수신자가 많으면 글 저장 지연도 증가할 수 있다. 실제 푸시 전송은 이미 별도 큐이지만, 수신자 찾기와 앱 내 알림 생성은 동기 작업이다. 수신자 수별 저장 지연을 측정하고 증가하면 이 부분을 작업 큐로 옮긴다. 관심 설정·선호 도시·차단·탈퇴·콘텐츠 접근 권한과 기존 전체 안전 모니터링은 유지한다.

## 추가로 측정할 DB 경로

- 도시별 피드에는 `(city_id, created_at desc, id desc)` 부분 인덱스와 커서가 있다. 카테고리를 추가로 고를 때 일치 글이 드문 도시에서는 더 많은 행을 확인할 가능성이 있다. 실제 계획을 보고 `(city_id, tag_id, created_at desc, id desc)` 인덱스 필요성을 판단한다. 지금 무조건 추가하지 않는다.
- `get_public_feed_page`는 제목·본문뿐 아니라 작성자 닉네임·동네와 `unnest(hashtags)`에 부분 일치 OR 검색을 한다(`supabase/migrations/0015_feed_profile_search.sql:36`). 제목·본문 trigram 인덱스만으로 모든 조건이 해결된다고 볼 수 없다. 큰 데이터에서 흔한 검색어·희귀 검색어·검색 결과 없음 각각의 실행 계획을 측정한다.
- 인기 해시태그는 요청마다 최근 7일 글을 집계한다(`supabase/migrations/0010_abuse_controls.sql:434`, `src/components/feed-screen.tsx:170`). 글 수에 따른 집계 비용을 측정한 뒤 캐시/사전 집계를 검토한다. 사용자별 차단 필터를 무시하는 공용 캐시는 피한다.
- 채팅 목록의 메시지·대화 구독은 클라이언트 필터가 없다. RLS가 수신 권한을 제한하므로 다른 사람의 메시지를 모두 수신한다는 뜻은 아니다. 다만 구독자별 권한 검사 비용은 별도 규모 점검 대상이다. [Supabase Postgres Changes 확장 가이드](https://supabase.com/docs/guides/realtime/postgres-changes).

## 이미 구현된 기반

- 홈 피드: `FlatList`, 30개 단위 커서 조회. 목록 API의 전체 테이블 내려받기 없음.
- 사진 30개가 있는 한 페이지의 서명 URL: 모의 호출에서 피드 RPC 1회 + 일괄 서명 1회.
- 댓글: 루트/답글 각각 커서 페이지, 펼치기 전 답글 조회 없음, 스레드 인덱스 존재.
- 검색 입력: 250ms 지연 후 조회. 이전 요청 취소/응답 순서 보호는 추가 검토 필요.
- 푸시 워커: 최대 100개 작업, 임대와 재시도, `FOR UPDATE SKIP LOCKED` 사용.

## 실행한 검증

다음 기존 테스트 **30개 통과, 0개 실패**. 기능 검증이며 대규모 성능 통과를 뜻하지 않는다.

```sh
node --experimental-strip-types --test scripts/categories.test.mjs scripts/feed-data.test.mjs scripts/comment-threads.test.mjs scripts/relationship-ui.test.mjs scripts/push-delivery.test.mjs
```

채팅 전체 이력 조회의 호출 수는 저장소 루트에서 아래처럼 재현할 수 있다. 실제 API 호출이나 사용자 데이터는 사용하지 않는다.

```sh
node --experimental-strip-types --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { loadConversations } from './src/lib/community-data.ts';
for (const total of [25, 50, 500, 5000]) {
  let calls = 0, offset = 0;
  const client = { async rpc(name, args) {
    assert.equal(name, 'get_conversation_previews');
    assert.equal(args.p_limit, 50);
    calls++;
    const data = Array.from({length: Math.min(50, total - offset)},
      (_, i) => ({id: `room-${offset+i}`, latest_at: '2026-09-12T00:00:00Z'}));
    offset += data.length;
    return {data, error: null};
  }};
  const rows = await loadConversations(client, 'audit-user');
  assert.equal(rows.length, total);
  assert.equal(calls, Math.floor(total / 50) + 1);
  console.log({conversations: total, rpcCallsPerRefresh: calls});
}
JS
```

미실시: 실기기 iOS/Android 프레임·메모리 프로파일, 운영 DB의 EXPLAIN/인덱스 배포 확인, 실제 네트워크 이미지 용량, 동시 사용자 부하 시험. 운영 서비스에 부하를 가하지 않았다. 별도 시험 환경에서 글 1만/10만 건, 댓글 1천 건, 사진 많은 피드, 대화 이력 500개, 관심 알림 수신자 증가를 각각 검증해야 한다. 측정 전 특정 동시 접속자 수를 보장할 수 없다.

## 카테고리 확인

현재는 `라이프·맛집·여행·쇼핑·정착·이동·주거·교육·모임` 9개 대분류 + 자유 해시태그다. 라이프 기본 제안은 `일상·질문·정보`, 이동은 `차량·교통·운전`이다. 라이프 안에 `생활꿀팁·자동차·집/이사`를 고정 선택하는 제안은 아직 구현되지 않았다. 자동차/집 정보를 묶는 방향을 변경할 때 기존 이동·주거와의 중복 및 기존 글을 함께 고려한다.
