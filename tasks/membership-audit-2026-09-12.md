# 멤버십 점검 — 2026-09-12

판정: 멤버십·구독 결제 코드는 이미 구현되어 있다. 이번 코드/로컬 DB 검사는 통과했지만 실제 스토어 구매부터 혜택 반영까지의 검증은 미완료다. 새 결제 시스템을 중복 구현하지 않았다.

- 구매·복원·스토어 관리: `src/lib/purchases.ts`, `membership-provider.tsx`, `src/app/profile/membership.tsx`.
- 공급자 검증·웹훅·서버 권한: `supabase/functions/membership/index.ts`, `_shared/membership.ts`, 기존 membership/relationship SQL.
- 로컬 iOS/Android RevenueCat 공개 키 설정 유무 확인: 둘 다 있음. 키 값은 기록하지 않음.
- 구독 관련 Node 검사 11/11, 전체 `npm test` 81/81, `npm run typecheck` 통과.
- `npx --no-install supabase test db supabase/tests/membership.test.sql supabase/tests/membership_limits.test.sql supabase/tests/relationship_slots.test.sql`: 로컬 DB 3개 파일, 100개 검사 통과. 운영 DB 검증으로 해석하지 않음.
- 최초 직접 psql 실행은 pgTAP `plan()`을 찾지 못해 실패했다. 기존 Supabase 테스트 실행기로 재실행한 위 결과가 최종 검증이다.

## 현재 스토어 조회

`asc subscriptions list --group-id 22374585 --output json`으로 Apple 상품 4개를 재조회했다.

| 상품 ID | 상품 | 상태 |
| --- | --- | --- |
| 6810726575 | Plus Monthly | MISSING_METADATA |
| 6810726662 | Plus Yearly | MISSING_METADATA |
| 6810726763 | Premium Monthly | MISSING_METADATA |
| 6810726825 | Premium Yearly | MISSING_METADATA |

Plus Monthly의 App Store review screenshot 조회는 없음으로 응답했다. 해당 상품 버전은 `PREPARE_FOR_SUBMISSION`이다. 나머지 상품의 누락 필드를 개별 검증하지는 않았다.

RevenueCat/Google 상품 연결은 `subscription-implementation-2026-09-10.md`의 기존 기록이며 이번에 운영 콘솔에서 재검증하지 않았다. Apple 계약·세금·은행의 현재 완료 여부도 이번 검사로 확정하지 않는다. Google 계좌 인증은 `play-account-verification-2026-09-12.md`를 따른다.

## 남은 검증

Apple 누락 메타데이터와 판매 자격 확인, 양 스토어의 설치된 테스트 앱에서 상품 조회·구매·복원·갱신·해지·만료·환불·등급 변경 후 서버 권한 확인이 필요하다. 실제 결제, 새 유료 서비스 가입, 스토어 심사 제출, 운영 설정 변경은 이번 점검에서 실행하지 않았다.
