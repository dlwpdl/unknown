# Spec: Gling Web Home

## Objective
Build a web home for Gling that reads like a real product website, not a scrollytelling landing experiment. It must explain what Gling is, where it is opening first, how the community flow works, how trust and policy are handled, and how to join the first cohort.

## Assumptions
- The web root stays inside the existing Expo web runtime.
- This first rebuild prioritizes information architecture and strong product presentation over WebGL-heavy effects.
- Store links are not finalized yet, so waitlist signup is the live primary CTA and store buttons are marked as coming soon.

## Commands
- Dev: `npm run web`
- Test: `npm run test:web-home`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`

## Project Structure
- `src/app/index.web.tsx` → web home route
- `src/app/index.web.css` → web home styles
- `src/lib/web-home.ts` → copy and derived city summaries
- `scripts/web-home.test.mjs` → smallest logic check for web-home data

## Code Style
- Use existing brand assets and real app screenshots.
- Prefer split layouts, clear hierarchy, and one dominant visual per section.
- Keep the route direct; avoid scene engines, WebGL plumbing, and decorative placeholder art.

## Testing Strategy
- One small Node test for city summary fallback/order and required policy disclosures
- `npm run typecheck`
- `npm run lint`
- Manual web verification in browser

## Boundaries
- Always: preserve core app facts, launch-city truth, and required policy disclosures.
- Ask first: adding dependencies, inventing live store URLs, or changing trust-policy scope.
- Never: fake a QR asset or imply download links are live when they are not.

## Success Criteria
- Web root presents Gling as a polished app website rather than an in-app feed or design report.
- Hero explains the app and offers a clear CTA.
- The site shows launch cities, community mechanics, trust/policy disclosures, and contact.
- Download area is prominent and honest about current store-link status.
- The old scene-based landing structure is removed.

## 2026-09-08 — B안 웹 반영

사용자가 리디자인 전 웹 화면과 앱 캡처가 남은 문제를 지적했다. 현재 앱의 종이색·인주색·타이포그래피를 웹에 맞추고, 스토어의 실제 B안 캡처를 직접 재사용한다. 도시 선택은 해당 도시 캡처·설명·오픈 알림을 함께 바꾼다. 출시 상태를 준비 중으로 고치고 목업 집계를 이용 실적으로 노출하지 않는다. 모든 안전 운영 설명과 정책 링크를 보존한다. 도메인 이메일과 SNS 가입은 도메인 결정까지 대기하며, 아직 작동하지 않는 이메일을 공개 연락처로 넣지 않는다.

검증: 기존 웹 도시 선택·정책 테스트, 타입 검사·린트·정적 내보내기, Orca Git → gling에서 320/768/1024/1440px·키보드 이동·도시 전환·이미지 로드·정책 링크를 확인한다. 새 라이브러리나 서버는 필요하지 않다.

확인 완료: 웹 회귀 검사 4/4, TypeScript, ESLint, 정적 내보내기 통과. `/gling` 경로의 내보낸 이미지·CSS·스크립트·파비콘 17개와 정책 3개가 존재한다. Orca의 실제 320/768/1024/1440px 화면에서 가로 넘침이 없고, Tab → Enter로 도시를 바꾸면 캡처·설명·메일 제목이 함께 바뀐다. 모든 이미지 로드·대체 텍스트, 44px 이상 조작 영역, 제목 순서, 본문 바로가기와 개인정보처리방침 이동을 확인했다. 주요 텍스트 대비는 5.18:1 이상이며 브라우저 오류·경고가 없다.

[데스크톱 화면](../output/design/gling-redesign/implemented/web-home-desktop.png) · [320px 화면](../output/design/gling-redesign/implemented/web-home-mobile.png). `http://localhost:8091/`의 Git → gling 탭에서 로컬 검증을 마쳤다. 사용자가 이 개편안의 반영과 푸시를 승인했다. 배포 대상은 기존 `dlwpdl/gling`의 `mobile-app` 브랜치이며, 기존 GitHub Pages 워크플로가 [공개 웹사이트](https://dlwpdl.github.io/gling/)를 갱신한다.

디자인 확인: 연결 BrandKit은 기본 템플릿 상태여서 승인된 앱 테마와 스토어 캡처를 기준으로 사용했다. Mobbin의 [Loom 제품 소개](https://mobbin.com/sites/sections/c2d8dd38-f6a9-401d-8749-b280c319cd46), [Aqua](https://mobbin.com/sites/sections/03f083e3-7838-429b-8800-3d25fad9310b) 이미지를 확인하고 Pinterest를 조회했다. Kroma는 API 키 미설정으로 사용할 수 없었다. 새 브랜딩·이미지 생성·외부 디자인 의존성 없이 기존 B안을 웹에 반영했다.
