# Spec: 9개 대분류와 해시태그

## Objective

지역 선택 아래 피드 필터와 글쓰기 화면에 동일한 9개 대분류를 제공하고, 세부 주제는 기존 해시태그 입력으로 처리한다. 실제 사용 빈도가 높은 해시태그를 피드와 글쓰기에서 반복 노출해 표기 파편화를 줄인다.

## Tech Stack

- Expo SDK 57 / React Native / TypeScript
- Supabase Postgres migration / pgTAP

## Commands

- 앱 검사: `npm run test:categories && npm run typecheck`
- DB 검사: `npx supabase db reset && npx supabase test db`
- 린트: `npm run lint`

## Project Structure

- `src/lib/mock.ts`: 앱 대분류와 mock 글
- `src/lib/hashtags.ts`: 인기·추천 해시태그 계산
- `src/lib/types.ts`: 대분류 slug 타입
- `src/i18n/ko.ts`: 대분류별 글쓰기 안내
- `supabase/migrations/`: 운영 태그와 기존 글 이관
- `supabase/tests/`: 대분류 DB 검증

## Code Style

```ts
{ id: 12, slug: 'settlement', label: '정착', kind: 'post' }
```

## Testing Strategy

- Node 기본 테스트로 9개 slug·순서·mock 글 참조를 검증한다.
- 빈도순 정렬, 대분류별 제안, 중복 없는 입력 추가를 검증한다.
- pgTAP으로 운영 DB의 9개 대분류와 기존 글 재분류를 검증한다.

## Boundaries

- Always: 앱과 DB slug 일치, 기존 글 보존, `모임`만 meetup kind 유지.
- Ask first: 대분류 추가·삭제, 정형 소분류 도입.
- Never: 기존 운영 글 삭제, 해시태그를 고정 소분류로 제한.

## Success Criteria

- 필터와 글쓰기 선택지에 9개 대분류가 같은 순서로 표시된다.
- 지역과 선택 대분류의 인기 해시태그가 빈도순으로 노출되고 탭으로 입력된다.
- 모든 mock/시드 글이 새 대분류 하나를 가진다.
- DB에는 legacy 태그가 남지 않고 총 9개 대분류만 존재한다.

## Open Questions

- 없음. 사용자가 9개 대분류+해시태그 방향을 승인했다.
