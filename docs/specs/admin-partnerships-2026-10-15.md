# 업체·크리에이터·협업·혜택 관리

2026-10-15. 사용자가 별도 업체/크리에이터 그룹과 협업 캠페인, 방문 혜택·쿠폰 관리 제안을 승인하고 어드민 구현을 요청했다. 범위는 비공개 어드민 운영이다. 공개 앱 모집 화면, SNS 게시·발송, 결제·지원금 송금, 신규 자동화는 포함하지 않는다.

## 운영 기준

- 기존 업체/회원/관리자 MFA·감사·밝은 관리자 디자인을 재사용한다. 업체와 크리에이터를 서로 다른 자료로 저장한다. 회원은 두 그룹에 동시에 연결될 수 있으며 새 인증 역할을 주지 않는다.
- 회원 가입 전 크리에이터도 실제 SNS 프로필과 연락 경로로 선등록할 수 있다. 회원 연결은 기존 회원 검색으로 선택하고 선택한 닉네임을 확인한다. SNS 연결은 운영자가 기록한 프로필이며 OAuth 소유 확인을 가장하지 않는다.
- 캠페인에서 지원 팀 → 선정 → 방문 확인 → 콘텐츠 제출 → 완료를 관리한다. 조회수는 출처 링크와 직접 확인 기록이며 신규 콘텐츠 성과를 보장하지 않는다. 한 참여 행이 한 팀이며 선정 이후 단계가 정원을 점유한다.
- 쿠폰은 혜택 정의와 개별 발급 내역을 구분한다. 대상·조건·유효기간이 확정된 활성 혜택에만 발급하며 서버에서 발급 한도·중복·만료·취소·현재 업체 동의를 검사한다. 사용/취소는 명시적 확인 후 한 번만 처리한다.
- 발급/선정 후 금전·대상·혜택 조건은 잠근다. 수정 시 오래된 revision을 거부한다. 불확실한 저장은 새 ID로 자동 재전송하지 않는다. 상태·입력 보존과 다시 조회 경로를 제공한다.
- 지원금은 지급 여부와 확인 메모를 기록한다. 송금 기능은 없다. 실적 없는 값은 미확인으로 표시하고 0과 구분한다.
- 기존 업체 삭제는 새 기록을 지우지 않는다. 삭제/동의 철회/중지된 업체의 새 선정·발급·사용을 차단한다. 기존 감사/안전 모니터링 범위는 유지한다.

## 데이터 계약

아래는 새 private 테이블의 필드다. 모든 자료에는 `id uuid`, `created_at timestamptz`, `updated_at timestamptz`가 있고 시각은 서버가 기록한다. 직접 anon/authenticated/service_role 접근을 허용하지 않고 RLS를 켠다. public RPC는 현재 `private.is_admin()`과 `log_admin_access('analytics', null, resource_id)`를 거친다. 변경 내역은 별도 private 감사 행에 기록하며 UI에 최근 20건을 표시한다. helper는 필요한 최소 범위에만 실행 권한을 준다.

| 자료 | 필드 |
|---|---|
| `partnership_creators` | `member_id uuid?`, `display_name text`, `city_id text`, `profile_url text`, `category text`, `contact text`, `reference_url text`, `reference_views integer?`, `metrics_note text`, `status active/paused`, `notes text` |
| `partnership_campaigns` | `merchant_id uuid`, `title text`, `status draft/open/paused/closed`, `terms text`, `terms_confirmed boolean`, `team_limit integer?`, `minimum_views integer?`, `support_amount_cents integer?`, `currency CAD/USD/null`, `deadline_note text`, `ends_on date?`, `notes text` |
| `partnership_participations` | `campaign_id uuid`, `creator_id uuid`, `stage applied/selected/visited/submitted/completed/declined/cancelled`, `scheduled_at timestamptz?`, `visited_at timestamptz?`, `content_url text`, `actual_views integer?`, `payment_status not_applicable/pending/paid`, `payment_note text`, `notes text` |
| `partnership_benefits` | `merchant_id uuid`, `campaign_id uuid?`, `title text`, `audience creators/members`, `status draft/active/paused/ended`, `discount_percent integer?`, `terms text`, `terms_confirmed boolean`, `expires_on date?`, `issue_limit integer?` |
| `partnership_coupons` | `benefit_id uuid`, exactly one of `creator_id/user_id uuid`, `recipient_name text` snapshot, `code text` unique server random, `status issued/redeemed/revoked`, `expires_on date`, `terms_snapshot jsonb`, `redeemed_at timestamptz?`, `revoked_at timestamptz?`, `action_note text` |
| `partnership_events` | identity `id`, `actor_id uuid?`, `resource_id uuid`, `action text`, `details jsonb`, `created_at timestamptz`; retain history and actor FK set null on account removal |

Creator name 1–120 chars, title 1–160; profile URL required, other URLs optional. Reuse `private.valid_merchant_original()` and client `safeMerchantSourceUrl()` for HTTPS public links. Text bounds: category 80, contact 1000, notes/terms 3000, metrics/payment note 1000, deadline note 300. Views 0–2147483647, amount cents 0–99999999, team/issue limit 1–10000 or null, discount 1–100 or null. A reference view count requires its reference URL. City and linked active member must exist. Unique non-null member link and canonical social profile, and unique campaign/creator participation. Optional blank UUID/date/number values are represented as null.

Opening a campaign requires a current undeleted `record_kind=business` merchant with granted consent and non-paused status, confirmed nonempty terms, a future/current end date in the merchant timezone, and currency if an amount is proposed. Drafts may retain unresolved amount/currency/date. Selected/visited/submitted/completed count towards team_limit under a campaign row lock. Only applied→selected/declined/cancelled, selected→visited/cancelled, visited→submitted/cancelled, submitted→completed/cancelled; same-stage edits allowed. visited requires actual past `visited_at`; submitted/completed require `content_url`. Paid requires submitted/completed and a nonempty payment note, and cannot be silently undone/cancelled. No 5,000-view payout condition is inferred. Cancelling a selected team revokes its unused campaign coupons. A paused creator cannot be newly selected or receive/use coupons.

Activating a benefit requires current merchant consent, confirmed nonempty terms, and current/future expiry. A linked campaign must belong to that merchant; only creator benefits may link a creator campaign. Creator issuance for a linked campaign requires selected/visited/submitted/completed participation and an open, unexpired campaign. Member issuance requires an active member. Each benefit/recipient is issued at most once, including revoked history. The issuance cap counts all issuance history. Currency/conditions remain unchanged after selection; coupon terms/recipient/campaign/expiry remain unchanged after issuance. Redemption rechecks current merchant, creator/member, benefit active status, timezone expiry and selected participation. Concurrent last-slot selection/issuance and double redemption cannot both succeed.

### RPCs

1. `get_admin_partnerships(p_kind text, p_search text default '', p_offset integer default 0, p_id uuid default null, p_child_offset integer default 0) returns jsonb`.
   - kind is `creators|campaigns|benefits`; rows ordered by updated_at desc/id with 50-row pages and real `more`.
   - Returns `{kind, rows, record, participations, coupons, events, more, children_more}`. Arrays are always present. record is null without p_id; requested missing IDs fail `PARTNERSHIP_NOT_FOUND`.
   - Creator record/list: base fields plus `member_name`, `city_name`, `participation_count`.
   - Campaign record/list: plus `merchant_name`, `city_name`, `selected_count`, `applicant_count`. Detail participations: base plus `creator_name`, `creator_profile_url`, `campaign_title`, `merchant_name`.
   - Benefit record/list: plus `merchant_name`, `campaign_title`, `issued_count`, `redeemed_count`. Detail coupons: base plus `benefit_title`, `merchant_name`.
   - Creator detail shows its participations; campaign detail shows its participations; benefit detail shows its coupons. Child pages are independently bounded to 50. Events are `{id, actor_name, resource_id, action, created_at}`.
   - Search matches human names and linked merchant/campaign names; no unbounded private directory load.
2. `save_admin_partnership(p_kind text, p_record jsonb, p_expected_updated_at timestamptz default null) returns uuid`.
   - kind is singular `creator|campaign|benefit|participation`. The client generates stable `p_record.id` once per new editor. Explicit field allowlists and typed validation; server-owned fields and unknown keys cannot override audit/code/times.
   - Null expected revision is create-only. Existing id with null revision or mismatched timestamp fails `PARTNERSHIP_CHANGED`. Update requires the exact last-read timestamp.
   - Lock current actor/profile role consistently with existing merchant mutation patterns and recheck authorization after lock waits; lock related rows in a consistent order. Same-stage save updates editable metadata, preserving existing immutable links.
3. `issue_admin_benefit_coupon(p_id uuid, p_benefit_id uuid, p_creator_id uuid default null, p_user_id uuid default null) returns uuid`.
   - A stable request id must match its original benefit/recipient on retry. Same exact request is idempotent; different payload fails. Random coupon code is generated server-side; it grants no unauthenticated access.
4. `act_admin_benefit_coupon(p_id uuid, p_expected_updated_at timestamptz, p_action text, p_note text) returns uuid`.
   - action `redeem|revoke`, nonempty note max1000. Lock and check revision/state before any change. No redemption after revoked/expired or re-use; repeated calls do not write a second event.

Expected errors map to plain Korean: `ADMIN_REQUIRED`, `INVALID_PARTNERSHIP`, `PARTNERSHIP_NOT_FOUND`, `PARTNERSHIP_CHANGED`, `PARTNERSHIP_TERMS_REQUIRED`, `PARTNERSHIP_TERMS_LOCKED`, `PARTNERSHIP_CAPACITY`, `PARTNERSHIP_STAGE`, `PARTNERSHIP_DUPLICATE`, `PARTNERSHIP_INACTIVE`, `COUPON_ALREADY_ISSUED`, `COUPON_UNAVAILABLE`.

## 화면과 검증

Existing admin navigation becomes 업체 관리, 크리에이터, 협업 캠페인, 혜택·쿠폰 in a 제휴 운영 group; Ticketmaster stays in 수익. Lists show names/status/next operation. UUIDs, raw JSON and schema details are not default content. Forms are explicit, not a generated schema editor; 44px controls, keyboard dialogs, saved/dirty/error/loading states and `useInteractionFeedback().play()` follow the existing implementation. Native private-admin stubs remain inaccessible as appropriate.

Owner follow-up: existing merchant contact text exposes safe HTTPS links and explicitly named Instagram/Threads/TikTok/YouTube handles as links in both the directory and detail header. Open in a new tab with noopener/noreferrer and interaction feedback; clicking a link does not open the row editor. Keep emails and ambiguous bare handles as text. Reuse the existing contact field and URL validator; no new database field or account-ownership claim.

References actually observed 2026-10-15: [Navattic list/detail](https://mobbin.com/screens/79a31934-4ca2-4700-86a5-c180fa735404), [Stripe filtered customer list](https://mobbin.com/screens/d412df8a-c1d6-4d9c-af5d-04fd317f627f). BrandKit product tokens match public Gling; existing private admin light tokens take precedence on this surface. Kroma could not run without its configured key; it is not used as observed evidence. Expo v57 exact documentation read before code. No image generation is involved.

Success: independent persisted CRUD of the three groups, real member/merchant pickers, team lifecycle with content/payment records, benefit issuance and one-use/cancel history; unauthorized/AAL1/expired sessions denied with audited reads/actions; stale saves and quotas tested on real Postgres; existing admin/merchant features pass. Render actual components at desktop and 390px, test core controls, and save an offline HTML preview under output/design. Production migration and private export require the normal existing release checks/rollback; configuration, preview, saved operations and public campaign activity are reported separately.

The pilot merchant proposal is retained separately in protected operations records. Prepare internal campaign/benefit drafts with unresolved conditions; do not activate, issue real coupons, invent applicants, publish recruitment or copy private proposal details into public source fixtures.
