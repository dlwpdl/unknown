# Spec: 카카오 단일 로그인

## Objective

앱에서 카카오 로그인만 제공하고 Supabase 세션을 생성·복원·종료한다. 카카오 로그인은 카카오 계정 소유 확인이며 국적·실명 인증으로 표시하지 않는다.

카카오 설정이 끝나기 전까지 개발 빌드에서는 같은 버튼이 브라우저를 열지 않고 L3 관리자 미리보기 계정으로 들어간다. 배포 빌드의 실제 OAuth 경로는 그대로 유지한다.

## Tech Stack

Expo 57, Expo Router, `expo-linking`, `expo-web-browser`, `@supabase/supabase-js`를 그대로 사용한다. 새 의존성은 추가하지 않는다.

## Commands

- Test: `npm run test:auth`
- Type: `npm run typecheck`
- Lint: `npx eslint src/lib/auth.tsx src/lib/kakao-auth.ts src/components/login-panel.tsx scripts/kakao-auth.test.mjs`
- Build: `npx expo export --platform web`

## Project Structure

- `src/lib/kakao-auth.ts`: OAuth 콜백 URL 검증
- `src/lib/auth.tsx`: Supabase 세션과 카카오 OAuth
- `src/components/login-panel.tsx`: 카카오 단일 버튼과 오류 상태
- `scripts/kakao-auth.test.mjs`: 콜백 경계 단위 검사

## Code Style

```ts
const code = getOAuthCode(callbackUrl, redirectUrl);
await supabase.auth.exchangeCodeForSession(code);
```

기존 컨텍스트와 디자인 토큰을 재사용하고 사용자에게 내부 오류를 노출하지 않는다.

## Testing Strategy

정상 콜백, 다른 출처, 공급자 오류, 코드 누락과 개발 전용 미리보기 경계를 작은 단위 검사로 검증하고 타입·lint·Expo export를 실행한다. 실제 로그인은 카카오와 Supabase 공급자 설정 후 배포 후보 빌드에서 확인한다.

## Boundaries

- Always: PKCE, 정확한 콜백 URL 검증, 공개 키만 앱에 저장
- Ask first: Supabase 공급자 설정 변경, 기존 관리자 역할 이전
- Never: Client Secret을 앱 환경 변수나 저장소에 추가, 카카오 로그인을 국적·실명 인증으로 표시

## Success Criteria

- 로그인 화면에는 카카오 버튼만 보인다.
- `gling://auth/callback`의 정상 코드만 세션으로 교환한다.
- 앱 재실행 시 Supabase 세션을 복원하고 로그아웃 시 세션을 종료한다.
- 오류와 취소 후 재시도할 수 있다.
- 개발 빌드에서는 카카오 창 없이 L3 관리자 미리보기로 진입하고, 배포 빌드에서는 이 우회가 꺼진다.

## Open Questions

- 카카오 Client ID·Client Secret 등록과 Supabase Redirect allow list는 사용자 설정 후 실제 기기에서 확인한다.
