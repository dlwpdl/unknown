# Ticketmaster / Impact 운영 연결

## 2026-09-24 적용 상태
- 기존 관리자 `http://localhost:54321`의 `.admin-dist` 빌드 갱신. Google/관리자 이메일 로그인 유지, 샘플 화면 진입 없음.
- `ticketmaster-revenue` Edge Function 배포. 관리자 JWT 검증 및 기존 `log_admin_access('analytics')` 후 합계만 제공. 비로그인 실제 응답 401 확인.
- Ticketmaster 기존 `gling-App` Consumer Key Approved/Public APIs Enabled 확인. 키는 저장소 외부 소유자 전용 파일에서 Supabase server secret `TICKETMASTER_API_KEY`로 등록. 키/Consumer Secret은 앱 번들에 포함하지 않음.
- 실제 Discovery 조회 성공: Vancouver 715 events, 반환 구매 링크 host `ticketmaster.evyy.net`. 건수는 확인 시점 값이며 고정 데이터가 아님.
- 제휴 ID가 개발자 프로필에 Impact/Canada/7843652로 등록돼 있는 것을 확인. 이는 수익 승인/확정 증거가 아님.
- production `0105_ticketmaster_events`만 트랜잭션으로 적용하고 migration history 기록. 기존 미관련 migration을 일괄 push하지 않음.
- `ticketmaster-events` Edge Function 배포 및 실제 비로그인 요청 401 확인. 캐시/요청량 테이블 RLS 활성화 확인. 관련 Node 테스트 11/11 통과.
- Impact 재로그인 완료. `Gling Admin Revenue` API v16 토큰 생성: `GET /Mediapartners/<AccountSID>/Actions`, `GET /Mediapartners/<AccountSID>/Campaigns` 두 읽기 권한만 허용. AccountSID/AuthToken은 저장소 외부 0600 파일과 Supabase server secrets에 등록.
- 실제 Campaigns API 인증 HTTP 200, `InsertionOrderStatus=Active` 결과 0개. Ticketmaster 신청 화면도 In Review. 승인된 Ticketmaster campaign ID가 없어 해당 secret은 미설정, 수익 숫자는 미연결(`—`) 유지. 승인 후 Campaigns 조회로 ID/브랜드를 검증하고 연결해야 함.
- 앱 행사 화면 소스 구현 완료. 기존 설치된 1.0.3 앱에는 새 빌드 배포 전까지 반영되지 않음.

## 2026-09-25 날짜·가격·행동 분석 갱신
- production에 `0106_event_behavior_analytics`만 트랜잭션으로 적용하고 migration history를 확인했다. 로컬 pgTAP 24/24, production 허용 ID·화면명 조회를 확인했다.
- `ticketmaster-events` Edge Function을 재배포했다. 날짜별 검색과 월별 행사 있는 날 조회가 추가됐으며, 토론토 9월 26일을 시뮬레이터에서 선택해 같은 날짜의 행사 목록이 나오는 것을 확인했다. 달력의 점은 월 첫 200건에서 확인된 날이며, 나머지 날짜도 검색할 수 있다.
- 출시된 1.0.3 앱의 UI는 새 빌드가 배포되기 전까지 이전 버전이다. GA4는 아직 연결되지 않았고 자체 행동 분석만 활성화됐다.

## 2026-09-27 행사 영상 소스
- YouTube 검색을 중단하고 `YOUTUBE_DATA_API_KEY` 서버 secret을 제거했다. 행사·출연자의 Ticketmaster 데이터에 직접 연결된 영상 URL만 재생한다.
- 영상 URL이 없거나 재생할 수 없으면 스포트라이트의 행사 사진에 줌 효과를 적용한다. 검색에서 얻었던 결과가 남지 않도록 행사 상세·스포트라이트 캐시 키를 새로 분리했다.

## 2026-10-07 읽기 전용 제휴 연결 재확인
- 기존 Impact 조회 전용 인증으로 Campaigns API를 재조회했다(2026-10-07 20:36 Vancouver / 2026-10-08T03:36:20Z). HTTP 200, 전체 프로그램 0개·활성 프로그램 0개이며 전체 페이지 조회 범위가 완결됐다.
- 현재 신청의 심사/거절 상태, 계약 수수료율, 인정 판매, 수수료 및 은행 입금은 이번 조회에서 확인하지 않았다. 9월 24일의 In Review를 현재 상태로 단정하지 않는다. 기존 추적 링크와 수익 화면 구현은 활성 수수료 계약의 증거가 아니다.
- 설정·계약 변경 없음. 근거: `marketing/reports/2026-10-07/gling-ticketmaster-bm-check.json`.

## 필요한 서버 secret
| 이름 | 용도 |
|---|---|
| `TICKETMASTER_API_KEY` | 행사 Discovery Consumer Key (등록 완료) |
| `IMPACT_ACCOUNT_SID` | Impact 읽기 전용 API Basic 인증 사용자 (등록 완료) |
| `IMPACT_AUTH_TOKEN` | Impact 읽기 전용 API 토큰 (등록 완료) |
| `IMPACT_TICKETMASTER_CAMPAIGN_IDS` | 승인된 Ticketmaster 프로그램 ID, 여러 개면 쉼표 구분 |

Impact 계정 번호/Publisher ID `7843652`는 AccountSID나 Campaign ID의 대체값이 아니다. 계약/출금 설정을 앱에서 수정하지 않는다.

## 숫자의 의미
최근 3개월 중 **구매 발생 월**을 선택한다. 해당 월 수수료의 현재 상태를 표시한다.
- 확정 대기: Action.State=PENDING
- 승인 후 정산 대기: APPROVED, ClearedDate 비어 있음
- 정산 완료: APPROVED, 실제 ClearedDate 있음 (Impact 잔고 반영, 은행 입금 아님)
- REVERSED 제외. 판매액 Amount 대신 파트너 수수료 Payout을 통화별 정밀 합산.
- 부분 조회/중복 페이지/불완전 집계는 오류로 처리. 캐시는 인스턴스 내 5분, 새로고침은 캐시를 강제로 무효화하지 않음.
- 계정의 허용 Ticketmaster campaign 전체 기준. 향후 같은 계정으로 다른 제품을 운영하면 제품별 tracking sub-ID 또는 전용 계정으로 범위를 분리해야 한다.

## 검증 / 배포 명령
```sh
node --experimental-strip-types --test scripts/impact-revenue.test.mjs scripts/ticketmaster-events.test.mjs scripts/login-panel.test.mjs
npx tsc --noEmit
npm test
GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir .admin-dist
npx --no-install -- supabase functions deploy ticketmaster-revenue --project-ref wjvahbdwmctzpkndqaxa --use-api
npx --no-install -- supabase functions deploy ticketmaster-events --project-ref wjvahbdwmctzpkndqaxa --use-api
```
전체 Node 248/248, 로컬 DB pgTAP 7/7(transaction rollback), 타입검사 통과. 기존 의존성 audit high/critical 0, moderate 16. 실제 Impact 인증/프로그램 조회 HTTP 200 확인. 수익 합계의 실제 응답 검증은 Ticketmaster 제휴 승인 및 campaign ID 연결 후 필요.

## 중단/복구
행사 기능 중단은 Ticketmaster server secret 제거로 접근을 중단할 수 있다. 관리자 수익 조회 중단은 Impact server secret 제거로 미연결 상태가 된다. 캐시/할당량 테이블은 사용자 데이터와 독립적이며 제거 대신 유지해도 기존 모임 기능에 영향이 없다. 기존 회원/게시글/모임 schema와 권한은 변경하지 않았다.

공식 근거는 `docs/specs/ticketmaster-revenue-2026-09-24.md`와 `docs/specs/ticketmaster-events-2026-09-24.md` 참조.
