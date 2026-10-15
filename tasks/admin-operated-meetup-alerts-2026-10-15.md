# 운영 모임 신청 관리자 알림

사용자 요청: 본인 또는 AI가 만든 모임의 참여 신청을 관리자 계정에서 알 수 있게 한다. 후속 정정 “실제 사용자는 제외야”는 일반 사용자가 주최한 모임을 제외하는 것으로 확인했다.

기존 실시간 모니터는 `92b09c63-2356-4d58-970b-830f541a0483`의 metadata 수신 큐다. 원래 모임 신청 알림은 주최자 계정에만 간다. 새 자동화·AI 호출·서비스 대신 기존 DB 알림과 비동기 푸시 큐에 `admin_meetup_request`를 추가한다. 기존 모니터의 감지·ACK·관리 대기와 전체 안전 모니터링은 유지한다.

대상은 현재 관리자 또는 서버에 등록된 유효한 v4 운영 페르소나가 주최한 모임이다. 일반 사용자 주최, 운영·관리자·테스트 계정이 만든 신청은 제외한다. 새 대기 신청과 정식 재신청에만 알리며 기존 신청을 소급 발송하지 않는다. 기존 주최자 알림을 유지하고 관리자 본인이 주최자인 경우 관리자 사본을 추가하지 않는다. 신청 승인·거절이나 참가 약속은 하지 않는다.

알림 본문에는 신청자 닉네임과 모임 제목만 표시하고 비공개 신청 답변은 넣지 않는다. 기존 `/admin?section=posts`를 열어 제목으로 해당 글을 확인한다. 새로운 앱 경로나 클라이언트 변경은 없다. 기존 푸시 동의·기기·세션을 유지하며 추천 알림 하루8회 예산과 분리된 신청 알림이다. 기존 큐의 매분 실행에 따른 전달이며 실제 기기 표시를 보증하지 않는다.

삽입, 개인 알림함 SELECT RLS, 푸시 전송 적격성에서 현재 관리자 권한과 유효한 신청·모임을 다시 확인한다. 취소·승인·마감·삭제·차단·권한 해제 후 대기 중인 사본은 숨기고 전송하지 않는다. 원본 데이터와 신청 기록은 보존한다.

- 소스: `supabase/migrations/20261015223000_admin_operated_meetup_alerts.sql`
- 검사: `supabase/tests/admin_operated_meetup_alerts.test.sql` (기존 로컬 `supabase_db_gling`에서 migration+검사를 한 트랜잭션으로 실행 후 rollback)
- 선행 원칙: 기존 monitor/persona migration은 공유 원본에만 있어 새 migration은 그 미커밋 함수에 의존하지 않는다. 서버 소유 metadata 판정만 동일하게 적용한다.
- 공식 문서: [Postgres17 CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html), [Row security policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- **배포 보류 유지:** 운영 DB 적용, 원격 병합·태그, 앱/웹 배포, 푸시 발송은 하지 않는다. 실제 알림 수신은 운영 반영 이후 별도로 확인한다.

## 검증 결과

새 SQL33개 통과. 기존 푸시56개·관리자 보안10개·가입 알림18개도 통과했다. 기존 모임 알림의 관리자 조치2개와 모임 개인정보 검사의 관리자 조회는 로컬 관리자 MFA fixture가 현재 권한 계약을 충족하지 않아 실패했고, 변경 전에도 같은 결과를 확인했다. 관리자 권한 검사를 우회하거나 이번 변경에 기존 fixture 수정을 섞지 않았다. 코드 독립 검토에서 지적한 비공개 판정 함수 ACL과 삭제된 원본 조건은 수정하고 확인했다.

운영 DB와 자동화 설정은 변경하지 않았다. SQL 검사는 기존 로컬 DB 트랜잭션을 rollback했고 새 trigger 함수가 남지 않은 것도 확인했다. 실제 관리자 기기 수신과 운영 데이터 검증은 배포 이후 확인 대상이다. 상세: `/Users/ash/Desktop/Git/unknown/output/reviews/admin-operated-meetup-alerts-2026-10-15/verification.json`.
