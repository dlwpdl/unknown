# 내 도시 맛집·가볼 만한 곳 알림

사용자 승인: “내 도시에 맛집 업데이트 레스토랑 가볼만한 곳 이런것도 다 알림에 넣자 이런것도 알림설정에서 끌수잇게”. 기존 도시 추천·캐시·푸시·알림 설정을 확장한다. Ponytail, Apple Design, Postgres 권한 검사와 실패→성공 검증을 적용한다. 새 수집기·서비스·의존성·예약은 만들지 않는다. Mobbin MCP는 현재 연결되어 있지 않아 새 Mobbin 사례를 확인했다고 표현하지 않는다.

## 행동과 범위

- 설정의 도시 소식에 `city_food`(내 도시의 맛집·레스토랑)와 `city_places`(내 도시의 가볼 만한 곳·행사)를 추가한다. 각각 별도로 저장·해제하며 다른 설정과 메시지 미리보기를 보존한다.
- 신규 기본값은 켬. 기존 계정은 이전 도시 추천 `trending`의 켬/끔을 이어받아 기존 끄기를 무시하지 않는다. 이후 세 설정은 독립적이다. 휴대폰 푸시 전체 끄기를 유지한다.
- 기존 공개 글의 맛집 분류와 공개된 레스토랑·카페 소개, 여행·축제·도서관·산책 등 장소 소식, 기존 검증된 행사 캐시를 사용한다. 본문 키워드의 보조 분류는 기존 추천 규칙을 확장하며 AI나 별도 외부 검증을 새로 추가하지 않는다.
- 알림을 누르면 실제 해당 글/행사로 이동한다. 현재 도시·공개 상태·활성 계정·차단·등록 기기의 유효 세션을 발송 시 다시 확인한다. 이미 큐에 있는 도시 추천도 새 설정을 확인한다. 알림 종류는 새 도시 추천이며 좋아요·댓글·메시지와 명시적으로 구독한 관심 태그 알림을 바꾸지 않는다.
- 기존 추천의 현지 시간·야간 제한·하루 여섯 번·30분 간격·같은 대상 중복 방지·재시도 규칙을 공유한다. 같은 내용을 관심 태그로 이미 받은 사람에게 다시 추천하지 않는다. 기존 매 5분 추천 작업과 매분 푸시 작업의 ID/일정/현재 실행을 보존한다.
- 실제 고객에게 시험 발송하거나 영구 시험 데이터를 만들지 않는다. 소스·운영 DB 반영, 실제 시뮬레이터 화면, 스토어/웹 출시, 실기기 수신을 구분한다.

## 변경 지점과 계약

`src/lib/notification-preferences.ts`의 기존 카테고리와 `src/app/profile/notifications.tsx`의 ToggleRow를 재사용한다. 44px 터치 영역, 원래 iOS 스위치 높이, 선택 피드백 및 서버 읽기 결과를 유지한다. `scripts/notification-preferences.test.mjs`와 기존 설정 행동 검사에 저장·실패·독립성 검증을 추가한다.

`supabase/migrations/0147_city_discovery_alerts.sql`: 선호 두 필드와 새 알림 kind/category, 기본값·허용 입력·수신 권한을 현재 정의에 추가한다. 기존 `private.send_city_recommendations(timestamptz)`와 enqueue/claim/eligibility 경계를 확장하며 메시지 미리보기·관리자·후기 안전 검사를 보존한다. 분류는 보호된 `private.city_recommendation_category(text,uuid)`에서 한 번 정의하고 추천 및 발송 재검사에 재사용한다.

코드 스타일: `save({ city_food: value })`; SQL은 `security definer set search_path=''`, 완전 수식 이름, 명시 권한을 유지하고 현재 함수의 검증된 앵커만 확장한다. 다른 에이전트의 미커밋 파일, 공통 작업 계획, 기존 배포를 덮어쓰거나 넓게 커밋하지 않는다.

## 작업과 검증

- [x] 실패 검사: 두 설정의 실제 렌더·독립 저장·실패 보존, DB 분류와 선호 권한.
- [x] 최소 UI 및 DB 확장: 기존 설정·추천 경로 연결, 기존 끄기와 추천 한도 보존.
- [x] 롤백 SQL: 현재 도시·차단·숨김·세션 만료·대기 중 끄기·같은 대상·공유 한도, 기존 채팅/도시 추천 회귀.
- [x] `npm test`, `npx tsc --noEmit`, `npx eslint src/app/profile/notifications.tsx src/lib/notification-preferences.ts scripts/notification-preferences.test.mjs scripts/message-preview-settings.test.mjs`, 기존 Expo 앱 export.
- [x] 운영 보호 백업·현재 정의 확인→트랜잭션 dry-run→0147만 적용→저장된 정의·선호·기존 예약 재조회. Edge 함수/새 예약은 필요하지 않다.
- [x] 클릭 가능한 HTML을 현재 프로젝트의 기존 Orca 시안 탭에 표시하고 같은 Journal 시뮬레이터를 재열어 실제 화면을 확인한다. 공유 GUI guard를 사용하며 실제 계정 토글을 시험 변경하지 않는다.

SQL은 `docker exec -i supabase_db_gling psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1`에 선행 0140/0142/0143/0144/0145와 이번 migration을 단일 롤백 트랜잭션으로 전달한다. `supabase/tests/city_discovery_alerts.test.sql`과 기존 `city_recommendations.test.sql`, `message_preview.test.sql`을 확인하고 큐·예약·시험 계정의 전후 상태를 비교한다. 근거는 `output/qa/city-discovery-alerts-2026-10-09/`에 저장한다. Expo v57 notifications 공식 문서를 확인한다. 이미지 생성/편집은 해당 없음.

## 실제 검증과 반영

2026-10-09: 앱 전체 검사 575 통과·실패 0·기존 건너뜀 1. 설정 실패→성공과 독립 저장 검사, TypeScript·변경 lint·Expo 앱 웹 export 통과. 롤백 SQL 340건(신규 40, 도시 추천 59, 비즈니스 편의 119, 미리보기 46, discovery worker 20, push 56)이 통과했고 영구 데이터·로컬 예약을 바꾸지 않았다. 기존 도시 추천 시험의 실제 오후 클릭과 고정 오전 시계 불일치는 롤백 시험 안에서 클릭 시각을 정렬해 수정했다.

운영 프로젝트 `wjvahbdwmctzpkndqaxa`에 이번 `0147`만 적용했다. 보호된 Git 외부 백업, 현재 8개 함수와 제약의 변경 감지, dry-run 실제 롤백, 원자 적용 및 migration 원문 MD5/SHA256 조회를 확인했다. 기존 설정 5행은 선택을 이어받았으며 메시지 미리보기, 함수 소유자·실행 권한·RLS와 14개 기존 cron의 ID·명령·일정을 보존했다. Edge 함수·새 예약·시험 푸시 발송은 없다. 작업 중 다른 변경이 `0146_unlimited_direct_chat.sql` 번호를 사용해 이번 파일만 `0147`로 옮겼으며 SQL 내용은 동일하다. 해당 별도 migration은 이 작업에서 적용하지 않았다.

HTML은 320/390/768/1440px에서 독립 토글·메시지 미리보기 보존·7개 선택 피드백·44px·가로 넘침 없음·감소된 모션을 확인했다. 외부 요청·실제 발송은 0회다. 기존 현재 프로젝트의 시안 탭을 재사용했다. Journal `51A6BA64-7907-47E7-82AC-6386BA21F8D6`의 기존 앱을 다시 열고 새 두 항목 켬·미리보기 끔·밴쿠버 안내를 실제 AX와 화면으로 확인했다. 최종 화면에는 개발용 Refreshing 표시와 경고 배너가 없다. 계정 토글과 입력 초안을 변경하지 않았다.

새 Expo API를 사용하지 않았다. 지정된 v57 문서 캐시를 재사용했고 이번 notifications 공식 문서 재요청은 HTTP 403이었다. Mobbin MCP는 연결되지 않았으며 새 사례 검증으로 주장하지 않는다. 실기기 잠금 화면 수신, 햅틱 실감, App Store/웹 호스팅 배포와 실제 사용자 경험은 이번 검증에 포함하지 않았다. 설정 UI는 업데이트된 앱 소스·시뮬레이터에 반영했고 운영 추천 DB 반영과 스토어 출시는 구분한다.

최종 근거: `output/qa/city-discovery-alerts-2026-10-09/verification.json`, `production-readback.json`, `sql-verification.json`, `mock-checks.json`, `native-ui-verification.json`, `native-city-alerts.png`, `actual-prototype-tab.json`.
