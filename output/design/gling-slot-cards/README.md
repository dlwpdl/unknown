# 글링 관계 자리 표시 — 2026-09-10

모임·채팅·멤버십의 개별 네모칸을 **하나로 이어진 8pt 막대**로 정리했습니다. 인주색은 사용 중, 남색은 24시간 잠금, 연한 바탕은 남은 비율입니다. 남은 자리 숫자는 28pt에서 24pt로 줄이고, 막대 아래 중복되던 ‘남음’ 표기는 덜어냈습니다. 사용 중·잠금 수와 해제 시각은 읽을 수 있는 텍스트로도 제공합니다.

## 확인하기

- [기본 미리보기](index.html) · [다크](dark.html) · [큰 글자 200%](large.html)
- [375px 기본 이미지](01-light-375.png) · [큰 글자 이미지](02-large-text-375.png)
- [다크 이미지](03-dark-tiers-375.png) · [확인 중·한도 변경 이미지](04-unknown-and-overlimit.png)

HTML은 실제 `RelationshipSlotCard`·`ThemedText`·테마를 React Native Web으로 렌더링한 독립 미리보기입니다. 파일을 직접 열어 확인할 수 있습니다. 로컬 서버가 필요하면 `python3 -m http.server 8094 --bind 127.0.0.1 --directory output/design/gling-slot-cards`를 실행합니다.

## 디자인 근거

Apple 디자인 스킬의 정보 위계·간결함 원칙과 기존 글링 B 컨셉의 종이색·인주색·남색을 적용했습니다.

- [Mobbin · Google Photos](https://mobbin.com/screens/9887379e-abd7-42c1-ac14-0b2809caf976): 실제 화면의 얇은 용량 막대, 전체 수치와 범례의 관계를 참고했습니다.
- [Pinterest · iPhone Storage](https://www.pinterest.com/pin/578149670937594434/): 실제 이미지의 연속된 용량 표시와 짧은 범례를 참고했습니다.
- BrandKit은 `Your Brand` 기본값이므로 글링의 기존 `src/constants/theme.ts`를 유지했습니다. Kroma는 `SERPER_API_KEY` 미설정으로 검색 결과를 받지 못했습니다.

## 검증

- `npm run typecheck`, `npm test` 72개, `npm run lint`, `git diff --check` 통과.
- 기존 카드 테스트를 연속 막대에 맞춰 수정: 3·5·10자리 비율, 한도 초과 시 막대 길이 제한, 모임·대화의 독립 집계, 서버 정보가 없는 상태, 접근성 요약.
- Orca의 글링 프로젝트 탭에서 기본·다크·200% 글자에 대해 320·375·768·1024·1440px 레이아웃을 확인했습니다. 가로 넘침·카드 내부 잘림 0건, 각 미리보기에서 접근 가능한 상태 요약 7개와 키보드 포커스 가능한 멤버십 버튼을 확인했습니다.
- 큰 글자 미리보기는 Text 크기·줄 높이를 두 배로 키운 근사 검증입니다. 이번 변경의 네이티브 기기 검증과 새 TestFlight 업로드는 수행하지 않았습니다. 기존 TestFlight 1.0.0 (9)에는 이전 네모칸 디자인이 남아 있습니다.

재생성: `node output/design/gling-slot-cards/render.mjs`

카드 검증: `node --test scripts/relationship-slot-card.test.mjs`
