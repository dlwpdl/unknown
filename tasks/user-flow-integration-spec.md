# Spec: 글링 사용자 흐름 DB 통합

## Objective

가입 이후 글 작성, 반응, 댓글, 신고, 대화, 공유, 프로필 확인이 Supabase에 저장되고 관리자 화면까지 이어지는 닫힌 사용자 흐름을 만든다. 공개 앱은 카카오와 Google 로그인을 제공하며 개발 빌드에서는 별도 개발 계정으로 실제 Supabase 세션을 만들 수 있어야 한다.

## Assumptions

- 공개 인증은 카카오와 Google을 제공하며 개발용 이메일 로그인은 `__DEV__`에서만 노출한다.
- RLS, 관리자 감사 로그, 전체 콘텐츠 안전 모니터링 범위는 `ADR-0001`을 유지한다.
- 모임 참여의 첫 버전은 호스트와의 1:1 대화를 여는 방식으로 구현한다. 별도 그룹 채팅 스키마는 만들지 않는다.
- 게시글과 프로필 이미지는 비공개 Storage를 유지하고 인증 앱에서는 짧은 수명의 signed URL을 사용한다.
- 운영 웹 도메인이 없으므로 공유 URL은 공개 Supabase Edge Function을 HTTPS 진입점으로 사용한다.

## Tech Stack

- Expo SDK 57 / Expo Router / React Native / TypeScript
- Supabase Auth, Postgres, Storage, Realtime, Edge Functions
- Node test runner와 pgTAP

## Commands

- 앱 테스트: `node --experimental-strip-types --test scripts/*.test.mjs`
- DB 초기화·테스트: `npx supabase db reset && npx supabase test db`
- 타입 검사: `npm run typecheck`
- 린트: `npm run lint`
- 웹 빌드: `npx expo export --platform web`
- 함수 배포: `npx supabase functions deploy <name> --project-ref wjvahbdwmctzpkndqaxa`

## Project Structure

- `src/lib/`: Supabase 데이터 동작과 입력/응답 매핑
- `src/components/`: 기존 피드·상세·채팅·인증 UI
- `src/app/`: 피드, 공유 글, 채팅, 프로필 라우트
- `supabase/migrations/`: 원자적 쓰기 RPC, 카운터, 공개 단건 조회
- `supabase/functions/`: AI 초안과 공개 HTTPS 공유 페이지
- `supabase/tests/`: 실제 사용자 JWT 경계를 통과하는 DB 흐름 테스트

## Code Style

```ts
const { data, error } = await client.rpc('create_post', input);
if (error) throw error;
return data;
```

- 기존 `supabase` 클라이언트와 화면 컴포넌트를 재사용한다.
- 사용자 입력은 앱에서 빠르게 검증하고 DB/RPC에서 최종 강제한다.
- 네트워크 동작에는 로딩, 오류, 성공 상태를 제공한다.

## Testing Strategy

- 순수 응답 매핑과 URL 생성은 Node 단위 테스트로 검증한다.
- 글 작성 → 반응 → 댓글 → 신고 → 관리자 조회 → 대화 전송은 pgTAP 흐름 테스트로 검증한다.
- UI는 Expo 웹 빌드와 실제 브라우저에서 가입 게이트, 게시, 신고, 채팅 진입을 확인한다.

## Boundaries

- Always: 실제 Supabase 세션, RLS, signed URL, 관리자 감사 로그, 접근 가능한 버튼 이름과 오류 상태.
- Ask first: 새 유료 서비스, 운영 도메인 구매, 카카오/Apple 콘솔 변경.
- Never: service-role 키 또는 개발 계정 비밀번호를 앱 번들에 포함, RLS 완화, AI 자동 게시·자동 영구 제재.

## Success Criteria

- 개발 계정과 소셜 계정 모두 Supabase 세션을 사용하고 웹 재실행 후 세션이 유지된다.
- 글과 사진이 DB/Storage에 저장되고 필터와 무관하게 새 글이 즉시 보이며 실패 이유가 표시된다.
- 공감·저장·조회·댓글·댓글 공감·공유 수가 DB에서 갱신된다.
- 글·댓글·사용자·메시지를 신고할 수 있고 필요하면 사용자를 차단할 수 있다.
- 모임 참여와 DM이 실제 대화를 만들고 메시지가 Realtime으로 갱신된다.
- 공개 HTTPS 공유 주소에서 단일 글을 읽고 앱 로그인으로 이어질 수 있다.
- 나 페이지는 실제 지역, 통계, 저장글을 보여주며 비로그인 설정 진입을 막는다.
- 모바일 웹 내비게이션이 도시 선택을 가리지 않는다.
- 전체 자동 검증이 통과한다.

## Open Questions

- `OPENAI_API_KEY`가 프로젝트 비밀값에 없으면 AI 함수는 배포 후에도 실행 검증할 수 없다.
- 별도 운영 도메인이 생기면 Supabase 공유 함수 URL을 앱 웹 주소로 교체한다.
