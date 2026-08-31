# Spec: 사진 기반 AI 글·모임 초안

## Objective

사용자가 사진을 찍거나 고르면 AI가 9개 대분류, 제목, 본문, 해시태그 초안을 채우고 사용자가 수정한 뒤 게시한다. `meetup` 초안은 게시 시 기존 대화방 생성 흐름을 그대로 사용한다.

## Contract

- Request: `imageBase64`, `mimeType`, `cityName`, `selectedCategory`, 선택적인 `titleHint`, `bodyHint`
- Response: `{ draft: { categorySlug, title, body, hashtags } }`
- Errors: `{ error: { code, message } }`

## Boundaries

- 앱에는 OpenAI 키를 넣지 않고 인증된 Supabase Edge Function만 호출한다.
- 사진은 분석 요청에만 사용하고 OpenAI 응답 저장은 끈다.
- AI 결과는 자동 게시하지 않으며 제목·본문·태그를 사용자가 수정할 수 있다.
- 사진에서 확인되지 않는 브랜드, 가격, 상태, 날짜, 장소, 인원은 지어내지 않고 필요한 항목을 대괄호로 남긴다.
- 사진은 1장, 5MB 이하, 초안은 사용자당 하루 5회로 제한한다.

## Verification

- 외부 응답의 카테고리·문자열·해시태그가 앱 경계에서 다시 검증된다.
- `npm run test:ai-draft && npm run typecheck && npm run lint`
- 로그인 사용자만 Edge Function을 호출할 수 있고 6번째 일일 요청은 거부된다.
