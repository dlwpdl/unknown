# Spec: 글링 Supabase 백엔드 v1

## Objective

글링의 mock 데이터를 대체할 Supabase 기반을 만든다. 핵심은 일상 글 공유, 프로필 사진, 댓글·반응, 1:1 대화, 신고, 관리자 검토다.

## Assumptions

- 글은 만남 모집이 아니라 일상 공유가 중심이며 9개 생활 대분류와 자유 해시태그를 사용한다.
- 하루 한 편 제한은 유지하고 DB가 도시 시간대 기준으로 강제한다.
- 신고 대상은 사용자, 글, 댓글, 메시지다.
- 관리자는 `auth.users.app_metadata.role = 'admin'`인 계정만 인정한다.
- 관리자는 신고된 사용자의 프로필, 모든 글·댓글·메시지와 신고 처리 이력을 조회할 수 있다.
- 프로필/글 이미지는 인증 사용자만 읽는 비공개 Storage 버킷에 저장한다.
- Supabase 프로젝트 생성과 Auth 공급자 설정은 프로젝트 자격 증명이 필요한 배포 단계다.
- 현재 mock 15글·22댓글·17프로필은 운영 프로젝트의 초기 콘텐츠로 한 번만 시드한다.
- 기존 mock의 해시태그와 7개 방 미리보기는 보존하되, 실제 오픈채팅 기능은 계속 보류한다.
- 시드 프로필은 로그인할 수 없는 콘텐츠 작성자이고 실제 관리자 계정과 분리한다.
- 관리자 지정은 개인 이메일을 migration에 남기지 않고 운영 DB 상태로 적용한다.

## Tech Stack

- Expo SDK 57 / React Native / TypeScript
- Supabase Postgres, Auth, Storage, Realtime
- PostgreSQL RLS와 pgTAP 정책 테스트

## Commands

- DB 시작: `npx supabase start`
- DB 초기화: `npx supabase db reset`
- DB 테스트: `npx supabase test db`
- 타입 검사: `npm run typecheck`
- 린트: `npm run lint`

## Project Structure

- `supabase/migrations/`: 재현 가능한 DB 스키마와 정책
- `supabase/tests/`: RLS 허용·거부 테스트
- `src/lib/`: 다음 단계의 Supabase 클라이언트와 데이터 접근 코드
- `tasks/`: 현재 작업 스펙과 체크포인트

## Code Style

```sql
create policy "users update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
```

- 공개 스키마 이름은 `snake_case`, 외래 키는 `<entity>_id`로 쓴다.
- 사용자 입력 길이는 DB 제약으로 제한한다.
- `security definer`는 꼭 필요한 원자적 작업에만 쓰고 빈 `search_path`와 명시적 권한을 둔다.

## Testing Strategy

- pgTAP으로 익명 접근 거부, 소유자 쓰기, 타인 쓰기 거부, 방 멤버 메시지 접근, 관리자 전체 조회를 검증한다.
- 마이그레이션은 빈 로컬 DB에서 처음부터 적용한다.
- 앱 연동 단계에서는 TypeScript와 lint를 통과시킨다.

## Threat Model

- 신뢰 경계: Expo 클라이언트의 모든 DB/RPC/Storage 요청.
- 보호 대상: 대화 내용, 신고 정보, 관리자 권한, 사용자 이미지.
- 주요 오용: 다른 사용자 행 수정, 방 밖 메시지 열람, 신고 대상 위조, 관리자 사칭, 다른 사용자 폴더 업로드.
- 통제: 최소 grant + RLS, FK 기반 신고 대상, 서버 계산 작성일, `app_metadata` 관리자 판정, 사용자 ID Storage 폴더 정책.

## Boundaries

- Always: 모든 공개 테이블 RLS, 최소 권한 grant, 입력 길이 제약, 관리자 작업 기록.
- Ask first: 운영 Supabase 프로젝트 연결, Auth 공급자·SMS 설정, 실제 관리자 지정.
- Never: 앱에 service-role 키 포함, 클라이언트 값으로 관리자 판정, 대화 공개 버킷 저장.

## Success Criteria

- 인증 사용자는 자신의 프로필과 콘텐츠만 작성·수정할 수 있다.
- 사용자는 하루 한 편만 작성할 수 있고 클라이언트 날짜로 우회할 수 없다.
- 메시지는 방 멤버와 관리자만 읽을 수 있다.
- 신고 대상 작성자가 DB에서 자동 확정되어 위조할 수 없다.
- 관리자는 신고된 사용자의 글·댓글·메시지와 처리 이력을 조회할 수 있다.
- Storage 객체는 인증 사용자만 읽고 각 사용자는 자신의 폴더만 쓸 수 있다.
- 원격 DB에 mock 기준 6도시·9태그·17시드 프로필·15글·22댓글과 별도 관리자 프로필이 중복 없이 존재한다.
- 실제 관리자 계정의 `app_metadata.role`만 `admin`이고 시드 계정은 관리자 권한이 없다.

## Deferred

- 모임·룸메·렌트·중고거래, 슬롯 경제, 결제, 추천 피드, 별도 관리자 UI.
- 공개 오픈채팅 생성·가입 정책은 일상 공유와 1:1 대화가 검증된 뒤 추가한다.
