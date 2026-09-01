# Spec: 커뮤니티 안전·알림·성능 보강

## Objective

글링의 글쓰기, 모임 신청, 대화, 신고, 관리자 조치, 탈퇴 흐름을 실제 운영 가능한 상태로 닫는다. 사용자는 네이티브에서도 글을 쓸 수 있고, 모임은 호스트 승인 후에만 대화가 열리며, 중요한 활동과 관리자 조치를 앱 알림에서 확인한다.

## Assumptions

- 관리자 전체 데이터 조회와 현재 관리자 접근 방식은 운영 원칙대로 유지한다.
- L2 전화 인증과 L3 신분증 인증은 이번 범위에서 임시 상태를 유지한다.
- 차단은 과거 대화 기록을 지우지 않고 새 메시지와 새 상호작용만 막는다.
- 집단 신고는 소셜 계정 획득 비용을 기본 방어선으로 보고 추가 계정 연관 분석은 보류한다.
- 트렌드 해시태그는 도시·대분류·기간별 고유 작성자 수를 우선하며 한 사용자는 같은 태그에 한 표만 준다.
- 탈퇴 시 사용자가 만든 콘텐츠·대화·반응·신고·알림과 업로드 파일은 삭제한다. 같은 소셜 계정의 재가입을 막기 위해 인증 계정과 비식별 프로필의 `deleted` 상태만 남긴다.
- 이번 알림은 DB 기반 인앱 알림이다. APNs 원격 푸시는 Apple 개발자 자격과 개발 빌드가 준비된 뒤 같은 알림 테이블을 발신 원천으로 연결한다.

## Tech Stack

- Expo SDK 57 / Expo Router / React Native / TypeScript
- Supabase Auth, Postgres, RLS, Realtime, Edge Functions
- Node test runner / pgTAP

## Commands

- 앱 테스트: `node --experimental-strip-types --test scripts/*.test.mjs`
- DB 초기화·테스트: `npx supabase db reset && npx supabase test db`
- 타입 검사: `npm run typecheck`
- 린트: `npm run lint`
- 웹 빌드: `npx expo export --platform web`
- 의존성 감사: `npm audit --omit=dev`

## Project Structure

- `supabase/migrations/`: 요청 상태, 알림, 속도 제한, 안전 큐, 탈퇴 상태와 RPC
- `supabase/tests/`: 어뷰징·권한·상태 전이 pgTAP 테스트
- `supabase/functions/safety-monitor/`: 대기 중 콘텐츠 안전 분석 Worker
- `src/lib/`: 페이지네이션된 데이터 접근과 알림·모임·탈퇴 API
- `src/app/`, `src/components/`: 글쓰기 진입, 알림센터, 승인 시트, 탈퇴 확인 UI

## Code Style

```ts
const { data, error } = await client.rpc('request_meetup_join', input);
if (error) throw error;
return data;
```

- 기존 Supabase 클라이언트, 테마 토큰, 시트와 버튼 패턴을 재사용한다.
- 앱 검증은 UX용이고 DB/RPC 검증을 최종 경계로 둔다.
- 새 규칙은 범용 프레임워크 대신 명시적인 SQL 함수와 작은 타입으로 구현한다.

## Testing Strategy

- 공유 중복 방지, 해시태그 정규화, 페이지 커서 매핑은 Node 단위 테스트로 검증한다.
- 안전 재검토, 입력 크기, 호출 제한, 모임 요청 상태 전이, 알림, 탈퇴 잠금은 pgTAP으로 검증한다.
- 타입·린트·Expo export로 모든 라우트와 플랫폼 분기를 검증한다.
- 브라우저 제어가 가능할 때 글쓰기 → 요청 → 승인 → 알림 → 대화와 탈퇴 경고를 실제 클릭 검증한다.

## Boundaries

- Always: RLS, 서버 입력 제한, 원자적 상태 전이, 접근 가능한 레이블, 오류·빈 상태, 기존 관리자 전체 조회 원칙.
- Ask first: 외부 알림/이메일 서비스, 유료 AI 공급자 변경, 카카오·Apple 콘솔 변경.
- Never: 차단 시 과거 증거 삭제, 클라이언트만으로 호출 제한, AI의 자동 영구 제재, service-role 키 번들 포함.

## Success Criteria

- 게시글·댓글·메시지 수정 시 안전 큐가 새 콘텐츠로 다시 `pending` 처리된다.
- 로그인 계정은 같은 글 공유를 여러 번 실행해도 공유 수에 한 번만 반영된다.
- 해시태그는 서버에서 정규화·길이 제한되고 트렌드는 사용자당 같은 태그 한 표만 반영한다.
- 댓글·메시지·새 대화·모임 신청에 서버 속도 제한이 있다.
- 네이티브 글링 탭에서 글쓰기 잔여량을 보고 작성 화면을 연다.
- 모임 신청은 가벼운 메시지와 함께 대기하고 호스트 승인 후에만 대화방이 생긴다.
- 댓글·공감·메시지·모임 신청 결과·관리자 경고/차단이 인앱 알림에 표시된다.
- 신고 후 선택한 차단이 실패해도 신고 성공 여부를 정확히 안내한다.
- 탈퇴는 이중 확인 후 사용자 데이터를 삭제하고 최소한의 재가입 잠금 상태만 남기며 관리자만 잠금을 해제할 수 있다.
- 피드와 채팅은 서버 커서·제한 쿼리와 가상 리스트를 사용하고 피드 진입 시 댓글 본문을 내려받지 않는다.

## Deferred

- 실제 전화 OTP와 L3 신분증 인증
- APNs/FCM 원격 푸시 전달
- 개인정보처리방침·약관 웹 문서와 고객문의 이메일 확정
- 다계정 연관 탐지와 신고자 평판 점수
