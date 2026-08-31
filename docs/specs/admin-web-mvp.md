# Spec: 글링 관리자 웹 MVP

## Objective

글링 운영자가 `/admin`에서 카카오로 로그인하고, 서버가 발급한 관리자 역할로 전체 사용자·게시글·댓글·대화·메시지·신고를 조회하며 신고를 처리한다. 신고 여부와 무관한 전체 조회 범위는 `ADR-0001`을 따른다.

## Assumptions

- 첫 배포는 별도 API/프런트 저장소가 아니라 현재 Expo Router 웹 빌드의 `/admin` 경로다.
- 일반 앱과 같은 Supabase 프로젝트를 사용하며 브라우저에는 publishable key만 포함한다.
- 목록은 페이지 단위로 가져오고, 사용자 상세에서 해당 사용자의 전체 활동으로 이동할 수 있다.
- AI 안전 분류와 알림 자동화는 이번 UI 다음 단계다. 이번에는 관리 화면과 감사 로그 기반만 만든다.

## Tech Stack

- Expo SDK 57 / Expo Router / React Native Web / TypeScript
- Supabase Auth, Data API, RLS, Postgres RPC
- 현재 설치된 의존성만 사용

## Commands

- Dev: `npm run web`
- Unit tests: `npm run test:admin`
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Web build: `npx expo export --platform web`
- Database verification: `npx supabase db reset && npx supabase test db`

## Project Structure

- `src/app/admin.tsx` — `/admin` 라우트
- `src/components/admin/` — 관리자 웹 화면 컴포넌트
- `src/lib/admin.ts` — 관리자 역할 판정, 조회, 신고 처리
- `supabase/migrations/` — 관리자 접근 감사 로그
- `scripts/admin.test.mjs` — 권한과 표시 로직의 작은 단위 검사

## Code Style

```ts
export function isAdminRole(appMetadata: Record<string, unknown> | null | undefined) {
  return appMetadata?.role === 'admin';
}
```

- 권한 판정은 명시적인 `role === 'admin'`만 허용한다.
- 데이터 조회와 화면 표시를 분리한다.
- 관리자 페이지도 빈 상태·오류·로딩 상태와 키보드 접근성을 제공한다.

## Testing Strategy

- 순수 권한/표시 로직은 Node 기본 테스트 러너로 먼저 실패를 확인한 뒤 구현한다.
- RLS와 감사 RPC는 기존 pgTAP 테스트에 관리자/일반 사용자 경계를 추가한다.
- 실제 웹은 격리된 로컬 브라우저에서 로그인 게이트, 반응형 레이아웃, 콘솔 오류를 확인한다.

## Boundaries

- Always: 모든 관리자 조회·조치는 서버 역할 확인과 감사 로그를 거친다.
- Always: 전체 콘텐츠 조회 범위를 유지하고 service-role 키를 클라이언트에 넣지 않는다.
- Ask first: 관리자 역할 부여·회수, 사용자 정지·삭제, 외부 AI/알림 서비스 연결.
- Never: 클라이언트 플래그만으로 관리자 권한을 부여하거나 AI 출력으로 영구 제재한다.

## Success Criteria

- 비로그인 사용자는 카카오 로그인 화면만 보고, 일반 사용자는 접근 거부 화면을 본다.
- 관리자는 대시보드에서 신고·사용자·게시글·대화 목록을 페이지 단위로 조회한다.
- 사용자 선택 시 작성 글·댓글·보낸 메시지와 참여 대화를 확인한다.
- 열린 신고를 `actioned` 또는 `dismissed`로 처리하고 처리 기록을 확인한다.
- 관리자 섹션/상세 열람이 감사 로그에 남는다.
- `/admin`은 일반 앱 탭바 없이 데스크톱과 작은 화면에서 동작한다.
- 단위 검사, 타입 검사, lint, 웹 export가 통과한다.

## Open Questions

- 운영 도메인은 배포 시 `admin` 서브도메인 또는 `/admin` 중 선택한다. 현재 구현은 `/admin`이다.
- 안전 알림 채널의 우선순위(push/email/SMS)는 모니터링 단계에서 정한다.
