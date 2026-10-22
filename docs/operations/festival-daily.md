# 도시별 페스티벌 갱신

기본 목록은 시작 시간이 가까운 고유 페스티벌 최대 7개다. 같은 이름·공연장·연도의 날짜별 티켓은 한 페스티벌로 묶는다. 지난 행사, 취소·연기된 행사, 시간이 확정되지 않은 행사는 제외한다. 7개가 없으면 실제 등록된 수만 보여준다.

`tm-festival:<city>` 캐시는 도시 현지 자정까지 공유한다. 서머타임 종료일도 같은 현지 날짜 동안 한 번 수집한다. 현재 5개 도시의 기본 수집은 하루 5회의 Ticketmaster 검색이다. 한 번에 최대 100개 후보를 읽으며, 목록 밖의 수동 지정 행사만 상세 호출이 추가될 수 있다. 다른 행사 검색·날짜·월·상세 캐시의 15분 주기는 유지된다.

기존 `gling-trending-notifications` 작업의 5분 실행과 도시 순환을 재사용한다. 새 일자에 방문자가 먼저 오면 원자적 갱신 선점으로 즉시 수집하며, 다른 요청은 같은 수집을 중복 실행하지 않는다. 방문자가 없어도 기존 작업이 순환하며 수집한다. 알림을 꺼도 페스티벌 수집은 계속된다. 수집 실패는 성공한 빈 목록으로 저장하지 않으며 15분 후 재시도할 수 있다. 카드 순환은 API를 호출하지 않는다.

## 원하는 칸에 지정

별도의 제휴 전용 칸 없이 1–7번 중 아무 칸에 지정한다. 현재 구현은 Ticketmaster 행사 ID를 사용한다. 해당 도시의 상세 응답을 먼저 조회하면 목록 밖 행사도 기존 캐시에 저장된다.

기존 관리자 클라이언트의 로그인과 2차 인증(AAL2)을 완료한 상태에서 다음 RPC를 사용한다. 서버가 관리자·도시·행사·기간을 검증하고 기존 관리자 감사 기록을 남긴다.

```ts
await client.functions.invoke('ticketmaster-events', {
  body: { cityId: 'vancouver', eventId: 'OWNER_CHOSEN_EVENT_ID' },
});
await client.rpc('set_admin_festival_slot', {
  p_city_id: 'vancouver', p_slot: 3,
  p_event_id: 'OWNER_CHOSEN_EVENT_ID', p_ends_at: null,
});
await client.rpc('get_admin_festival_slots', { p_city_id: 'vancouver' });
```

`p_ends_at`으로 노출 종료 시간을 지정할 수 있다. 생략하면 행사 시작까지 유지한다. 행사 시작 이후로는 늘릴 수 없다. 같은 페스티벌을 다른 칸에 지정하면 기존 칸에서 이동한다. 동일 도시의 관리자 변경은 기존 도시 행을 잠가 동시에 중복 저장되지 않는다. 이름·공연장·연도의 식별 해시도 저장해 이전 API 캐시가 만료된 뒤에도 다른 날짜 티켓을 같은 페스티벌로 이동한다. 원문 데이터는 추가 저장하지 않는다. `p_event_id: null`로 해제하면 자동 선택으로 돌아간다. 변경은 다음 목록 조회부터 적용된다.

앱은 화면 포커스·포그라운드, 웹은 포커스·다시 표시될 때 목록을 재조회한다. 열린 화면도 현지 날짜 변경, 행사 시작, 지정 만료를 분 단위로 확인한다. 새 데이터 수집과 기존 캐시 조회는 별개다.

## 검증과 복구

```sh
npm test
npm run typecheck
npm run export:web
npm run check:public-web
npm run check:merchant-web
```

서버 변경은 `20261011233000_festival_daily.sql`과 식별값 보완 `20261012002000_festival_slot_identity.sql`과 `ticketmaster-events` 함수만 적용한다. 미관련 migration을 일괄 push하지 않는다. SQL 검사는 `supabase/tests/festival_daily.test.sql`을 로컬 트랜잭션에서 실행하고 롤백한다. 행 잠금 검사용 기본 PostgreSQL `pgrowlocks` 확장도 테스트 트랜잭션에서만 만들며 운영에는 설치하지 않는다.

2026-10-11 운영 배포·캐시·작업 소속·API 재조회 증거와 복구 SQL은 작업 기록의 `output/qa/festival-daily-2026-10-11/`에 보관한다. 복구는 백업한 Edge Function을 먼저 복원하고 `rollback.sql`로 기존 수집 함수·뷰·정리 작업을 복원한다. 수동 지정 데이터와 migration 이력은 삭제하지 않는다.

앱 1.1.7의 새 캐러셀은 정상 스토어 출시가 필요하다. 서버 배포, 웹 배포, 스토어 심사 제출, 사용자에게 실제 공개된 버전은 각각 확인한다.
