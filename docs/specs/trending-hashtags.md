# Spec: 트렌드 해시태그 정규화

## Objective

현재 도시와 선택한 대분류 안에서 많이 쓰인 해시태그를 먼저 보여주되, 표기 차이로 같은 피드가 갈라지지 않게 한다.

가정:

- 현재 mock 단계의 “트렌드”는 해당 도시 글의 사용 빈도이며, 동률이면 먼저 등장한 태그가 앞선다.
- 자유 입력은 유지하되 대표 표기로 통합하고 글당 최대 5개만 저장한다.
- 동네는 프로필의 구조화된 `neighborhood`를 우선하며, 동네명 해시태그 입력은 대표 표기로 정규화한다.

## Tech Stack

Expo 57, React Native 0.86, TypeScript 6, Node 내장 테스트 러너를 그대로 사용한다. 새 의존성은 추가하지 않는다.

## Commands

- 기능 테스트: `npm run test:categories`
- 타입 검사: `npm run typecheck`
- 린트: `npm run lint`

## Project Structure

- `src/lib/hashtags.ts`: 정규화, 별칭 통합, 추천 순위, 입력 제한
- `src/app/index.tsx`: 피드·검색·글쓰기 연결
- `scripts/categories.test.mjs`: 태그 동작 회귀 테스트

## Code Style

```ts
const hashtags = parseHashtags('#코퀴틀럼 Coquitlam 맛집');
// ['코퀴틀람', '맛집']
```

순수 함수로 동작을 모으고 화면은 결과만 사용한다.

## Testing Strategy

먼저 별칭 통합, NFKC 정규화, 중복 제거, 최대 5개, 빈도순 추천 테스트를 실패시킨 뒤 최소 구현으로 통과시킨다.

## Boundaries

- Always: 기존 카테고리·도시 범위를 유지하고 입력값을 렌더링 전에 정규화한다.
- Ask first: Supabase 태그 테이블/RPC 추가나 기존 운영 데이터 마이그레이션.
- Never: 위치를 자유 해시태그만으로 저장하거나 비밀키를 앱에 추가하지 않는다.

## Success Criteria

- `코퀴틀럼`, `코퀴틀람`, `커퀴틀람`, `Coquitlam`은 모두 `코퀴틀람` 하나로 집계된다.
- 추천은 현재 도시와 선택 대분류의 실제 빈도순으로 기본 태그보다 먼저 나온다.
- 직접 입력과 추천 칩 입력 모두 중복 없이 최대 5개로 저장된다.
- 검색에서도 별칭으로 대표 표기의 글을 찾을 수 있다.

## Open Questions

- Supabase 피드 연결 시 트렌드 기간은 7일과 30일 중 운영 데이터로 결정한다.
