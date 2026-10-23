# Webshop ordering and performance — approved owner requirements

Owner approved implementation and deployment on 2026-10-23; no further mockup approval is required. Later steering supersedes the earlier immediate-open proposal: the discount banner and main order button open one price comparison bottom sheet, whose order button opens the tracked webshop in the native system in-app browser, or a new web tab.

## Customer behavior

- Keep a place's existing identity, reviews, saves and old links. Unlinked places retain their detail page. Explicitly linked places navigate to the existing business profile for the same branch, independently of map multi-select order. Never name-match another branch or create duplicate businesses.
- Preserve the existing business profile's 소개 / 소식 / 채용 / 후기 and business-identity 1:1 inquiry, including login, unavailable-contact and self-contact checks. Keep the single top-right save action.
- Valid webshop: main order button and discount banner open the same comparison sheet. No webshop: no discount/order claim or empty order button; existing inquiry becomes the main action when an authorized contact exists, with location as a secondary action.
- Pins retain category color with a separate mint benefit badge. One physical place produces one pin even across Visited, restaurant and delivery filters. A delivery benefit needs a valid registered webshop and verified positive comparisons.
- Sheet: merchant name, maximum representative-menu percentage, three-menu monetary comparison, item table, comparison basis/date, fixed Uber order-support copy, one order action. Closing returns to the same business profile. No extra intermediate screens or automatic order-success claim on browser dismissal.
- Exact support copy: 주문 관련 문의·클레임은 Uber 고객지원을 통해 접수해주세요. Show near every Uber webshop order CTA, not only in collapsed details.
- Observed Safari base prices at 2026-10-23T11:02:46Z (CAD): Rose Forno 2400→1900 cents; Meat Lover 2400→2000; Chicken Alfredo 2300→1900. Representative maximum 20.8%; basket 7100→5800, saving1300 cents. These are menu subtotals, NOT final checkout totals or native-app observations.
- Owner confirmed no delivery/service/tax checkout data. Missing fees are unknown, never zero. Display a verified full checkout comparison only when both comparable quotes contain every mandatory component and a consistent total. Otherwise label menu-only savings clearly. Do not invent a coupon or claim promotion exclusivity.

## Attribution and admin

- Reuse existing Supabase/Expo dependencies, audit/MFA boundaries and the canonical private admin. No new hosted service, auth flow, paid provider, recurring job or analytics fingerprint.
- Record sheet views separately from outbound clicks. Outbound opens use an allowlisted server redirect keyed by business, never an arbitrary destination query. Server appends stable UTM parameters and logs a deduplicated click before redirecting. Web opening preserves the referrer with noopener, without noreferrer; no credentials in links.
- A click or browser close does not prove an order. Report verified provider/merchant order data separately from click metrics. Order-data absence is null/unavailable, not measured zero. Financial imports need report period, evidence and idempotent external order IDs, preserve currency and cancellation/refund data, and must not double-count reimports.
- Owner states 25% commission; exact settlement base has not been confirmed. Store rate separately from basis confirmation. Show commission as unknown until a basis is explicitly confirmed, and label computed amounts as estimated, not paid or settled.
- Admin Webshop Performance: date/business filters, sheet views, outbound clicks/sessions, verified orders/revenue, estimated commission when eligible, per-business/daily data, configuration and evidence-backed order-report import. No customer/card/address data or payment execution. Admin reads/writes are AAL2-protected and audited.

## Shared interface contract

Public descriptor `Webshop`:
`{ merchantId, url, provider: 'uber', cityId, placeKeys: string[], comparisons: {id,name,uberCents,webCents}[], verifiedAt, promoCode: string|null, checkoutComparison: object|null }`.

Place keys are canonical `osm:node|way|relation:<id>` or an explicit existing curated partner key, e.g. `partner:jimoco-coquitlam`. Links are branch/city-scoped. Public descriptors expose no commission/report/private fields. An enabled business with no webshop can still have a place link.

RPCs (server and admin implement these names and payloads):

1. `get_public_webshop(p_merchant_id uuid)` → descriptor or null; only public businesses and enabled valid webshops.
2. `get_city_business_links(p_city_id text)` → `{placeKey,merchantId}[]`; include linked public businesses even without webshops.
3. `record_webshop_event(p_merchant_id uuid,p_event_id uuid,p_session text,p_platform text,p_source text,p_kind text)` → void. Kind is `sheet_view`; whitelist source/platform and validate size. Logged-in business owners/admins are marked internal when identifiable.
4. `resolve_webshop_redirect(p_merchant_id uuid,p_event_id uuid,p_session text,p_platform text,p_source text)` → `{url}`; service_role only. Log idempotently and return an HTTPS registry destination with UTM. Edge Function `webshop-redirect` handles anonymous GET/HEAD; HEAD must not count a click, unknown IDs/URLs fail closed, no request-supplied destination.
5. `get_admin_webshops(p_days integer default30,p_merchant_id uuid default null)` → `{generatedAt,stores,totals,daily,breakdown,orders}`. `stores` contain merchantId/name/cityId/enabled/url/provider/placeKeys/comparisons/verifiedAt/promoCode/checkoutComparison/commissionBps/commissionBasisConfirmed. Totals have sheetViews/clicks/sessions/orderDataAvailable/verifiedOrders/netRevenueCents/estimatedCommissionCents/currency. Financial fields null when unavailable. Breakdown repeats metrics with merchantId/name. Daily has day/sheetViews/clicks/verifiedOrders/netRevenueCents. Orders contain reportId/merchantId/externalOrderId/orderedAt/currency/foodSubtotalCents/refundCents/status/attribution/evidence.
6. `save_admin_webshop(p_merchant_id uuid,p_config jsonb)` → saved store. Config uses the same store camelCase keys; enabled/url may be null/false while place links remain. Validate every public field, money integer bounds, destination, comparison IDs, dates and exact city/branch; optimistic `updatedAt` revision when updating an existing configuration. Keep admin-only commission fields private.
7. `import_admin_webshop_orders(p_merchant_id uuid,p_report_id uuid,p_period_start timestamptz,p_period_end timestamptz,p_evidence text,p_orders jsonb)` → `{reportId,imported,duplicates}`. Orders use `{externalOrderId,orderedAt,currency,foodSubtotalCents,refundCents,status,attribution}`. Status completed/cancelled/refunded/partial_refund; attribution provider_report/promo_code/unattributed. Evidence required, non-PII. Reject conflicting reimports; identical retry is idempotent. Unattributed orders may be shown as provider revenue but never silently called Gling-attributed conversions. Currency CAD for the initial feature; reject mixed/unsupported currencies. Refunds cannot exceed subtotal.

The backend may add necessary validation/audit fields but must keep these response names stable. Root owns the public TypeScript module and customer/map UI. Backend owns SQL/Edge Function. Admin owner owns admin TypeScript/UI/registration only.

`checkoutComparison` is null or `{verifiedAt,fulfillment:'delivery'|'pickup',basketLabel,sameConditionsConfirmed:true,uber:Quote,webshop:Quote}`. `Quote` contains every integer-cent field: itemsCents,deliveryCents,serviceCents,discountCents,taxCents,tipCents,totalCents. Every field must be explicitly observed (zero is allowed only as an observed value), all nonnegative and bounded; total must equal items+delivery+service+tax+tip−discount and be nonnegative. Same menu/options/fulfillment/delivery conditions must be confirmed before saving. Do not display the user's exact address.

Store configuration also has `commissionScope:'attributed'|'all_webshop'|null`. Null is the initial unknown scope. Commission requires commissionBasisConfirmed AND a nonnull scope; basis is net food subtotal after refunds, excluding cancelled orders and all delivery/service/tax/tip amounts. Scope determines whether only provider_report/promo_code-attributed orders or all report orders contribute. Keep all/provider-attributed revenue distinguishable in admin. No payout execution.

## Verification and release

- Test discount/basket integer money, missing/full quote consistency, malicious URLs and same-branch links; test multiselect deduplication and no-webshop/unavailable-contact cases; test view vs click vs order separation, financial idempotency/refunds/nulls and AAL2 denials.
- Commands: `node --experimental-strip-types --test scripts/*webshop*.test.mjs`, `npm run typecheck`, `npm run lint`, then the full existing test suite and relevant DB tests. Use exact Expo57 docs. Render real source in light/dark,320/390px, Korean/English and reduced motion; native QA only on the existing iPhone17ProMax F736, through the shared55-second guard and existing install owner.
- Current isolated checkout: gling-webshop-performance-20261023, base bbdca58. Preserve dirty mobile-app edits and the other active map-card/glass-filter writer; reconcile before integration. Canonical admin runtime stays gling-admin-current-20261017; do not replace login/MFA with an old export.
- Deploy additive server/read APIs before the client, then integrate verified source and use existing free release scripts/CI. Inspect actual store state and original authorized tracks. Never raise minimum supported versions before public installability is verified. No synthetic purchase/order in production or duplicate release submission.
