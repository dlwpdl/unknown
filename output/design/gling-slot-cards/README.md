# 글링 관계 자리 카드 — 2026-09-10

채팅·내 모임·멤버십의 텍스트 요약을 기존 B 컨셉의 공통 카드로 바꿨습니다. 남은 자리 숫자를 먼저 보여주고, **채워진 체크 = 사용 중 / 자물쇠 = 24시간 잠금 / 점선과 더하기 = 빈자리**로 구분합니다. 모임과 1:1 대화는 각각 서버가 준 3·5·10자리 풀을 사용합니다.

## 확인하기

- [기본 미리보기](index.html) · [다크](dark.html) · [큰 글자 200%](large.html)
- [375px 기본 이미지](01-light-375.png) · [큰 글자 이미지](02-large-text-375.png)
- [다크 3·5·10자리 이미지](03-dark-tiers-375.png) · [확인 중·한도 변경 이미지](04-unknown-and-overlimit.png)
- 실행 중인 로컬 미리보기: http://127.0.0.1:8094/

HTML은 최종 색상 대비 조정까지 포함합니다. PNG는 그 직전 캡처로 배치는 같으며, 최종 코드에서는 작은 ‘사용 중’ 글자를 본문색으로 바꾸고 하단 링크 면을 배경색 토큰으로 조정했습니다.

## 구현 범위

- `src/components/relationship-slot-card.tsx`: 공통 카드와 서버 상태 해석 함수
- `src/app/(tabs)/chat.tsx`, `src/components/my-meetups.tsx`, `src/app/profile/membership.tsx`: 기존 텍스트 요약 교체
- `scripts/relationship-slot-card.test.mjs`: 실제 내보낸 함수·컴포넌트에 대한 4개 검증

서버 값이 없거나 서로 맞지 않으면 빈자리로 추정하지 않고 확인 상태를 표시합니다. 잠금 해제 시각은 유효한 값 중 가장 가까운 시각을 표시합니다. 다운그레이드로 사용량이 현재 한도를 넘을 때도 실제 사용량을 보존합니다. 데이터·인증·결제·앱 설정은 변경하지 않았습니다.

## 디자인 근거

- 기존 `output/design/gling-meetups-v2/01-my-meetups.png` 및 HTML의 짧은 분할 막대를 다시 사용했습니다. 시안의 오래된 일일 제한 설명은 가져오지 않았습니다.
- [Mobbin · MacroFactor Strategy](https://mobbin.com/screens/215233aa-292a-42c2-aa5a-d8740ade221c): 실제 화면의 큰 체크인 잔여 일수와 보조 시간 정보 위계를 참고했습니다. 원형 그래프는 복제하지 않았습니다.
- [Mobbin · Future Pro Progress](https://mobbin.com/screens/e8973bdb-59de-4269-8edf-167892981eaa): 실제 화면의 활동 표시와 카드 하단 집계 구성을 참고했습니다.
- [Pinterest · Membership / Tiered Loyalty Program](https://www.pinterest.com/pin/31877109858303912/): 실제 이미지의 등급 칩, 큰 포인트 수, 짧은 진행 막대가 한 카드에 모인 구성을 참고했습니다. 장식 메달과 그라디언트는 사용하지 않았습니다.
- BrandKit 연결 결과는 글링 브랜드가 아닌 `Your Brand` 기본값이어서 기존 글링 `theme.ts` 토큰을 유지했습니다. Kroma는 `SERPER_API_KEY` 미설정으로 결과를 받지 못했습니다.
- apple-design 및 frontend-ui-engineering 지침을 적용했습니다. 모션을 새로 넣지 않았고, 링크 터치 영역은 최소 44pt이며 글자 크기 확대를 제한하지 않습니다.

## 검증 결과

- TypeScript, 변경 파일 ESLint, `git diff --check` 통과.
- 새 테스트 4개 통과: 3·5·10/독립 풀/가장 가까운 해제 시각, 미확인 상태, 한도 초과, 접근성 설명과 서로 다른 기호.
- 실제 컴포넌트 + React Native Web + 실제 테마를 렌더링한 별도 정적 harness로 확인했습니다. Expo/Metro 및 서버 연결을 사용하지 않습니다.
- 375px 기본·다크·글자 200% 확인. 200%에서 320·375·768·1024·1440px 모두 카드 내부 가로 넘침과 텍스트 잘림 0건.
- 접근성 트리에서 7개 상태의 전체/남음/사용 중/잠금 요약과 깨끗한 버튼 이름 확인. 색 외에 체크·잠금·더하기 기호로 상태를 구분합니다.
- 콘솔 오류 0건. 완료한 Orca QA 탭은 닫았고 사용 중인 Instagram/admin 탭은 유지했습니다.

큰 글자 harness는 Text의 fontSize/lineHeight를 2배로 조절한 근사 검증이며 실제 iOS Dynamic Type 기기 검증을 대신하지 않습니다. SSR에서는 설치된 Material Symbols 폰트와 expo-symbols의 같은 매핑을 사용합니다. 네이티브 상호작용과 전체 로그인 흐름은 이번 카드 검증 범위에 포함되지 않습니다.

재생성: `node output/design/gling-slot-cards/render.mjs`

검증: `node --test scripts/relationship-slot-card.test.mjs`
