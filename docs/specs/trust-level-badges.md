# Spec: 신뢰 레벨 배지

## Objective

닉네임 옆 배지로 높은 인증 범위를 한눈에 알린다.

- L1: 소셜 계정 확인, 배지 없음
- L2: 전화번호 확인, 빨간 링과 회색 점
- L3: 신분증과 얼굴 대조 완료, Gling 앱 마크

## Tech Stack / Structure

- Expo SDK 57, React Native, 기존 `expo-image`와 테마 토큰만 사용한다.
- 배지 UI는 `src/components/trust-badge.tsx`, 레벨 정규화는 `src/lib/trust.ts`에 둔다.
- L3는 기존 `assets/brand/gling-app-icon.png`를 재사용한다.

## Commands

- Test: `node --experimental-strip-types --test scripts/trust-levels.test.mjs`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

## Code Style

```tsx
<TrustBadge verified={author.verified} trustLevel={author.trustLevel} />
```

기존 `verified`/`trustLevel` 데이터를 재사용하고 새 상태 관리나 의존성을 추가하지 않는다.

## Testing Strategy

작은 단위 테스트로 기존 데이터가 L1·L2·L3에 정확히 매핑되는지 확인하고, 앱에서 작은 크기의 가독성과 접근성 라벨을 확인한다.

## Boundaries

- Always: 숫자뿐 아니라 접근성 설명으로 인증 범위를 전달한다.
- Separate work: SMS 인증과 신분증·얼굴 심사 백엔드.
- Never: 디자인 확인용 관리자 계정 외에는 L3 심사를 완료하지 않은 계정에 L3를 부여하거나 카카오 로그인을 실명 인증으로 표현하지 않는다.

## Success Criteria

- L1은 숨고, L2·L3만 지정된 형태로 닉네임 옆에 표시된다.
- 피드, 댓글, 프로필 시트, 채팅의 기존 인증 표기가 같은 컴포넌트를 사용한다.
- 타입 검사·린트·신뢰 레벨 단위 테스트가 통과한다.
