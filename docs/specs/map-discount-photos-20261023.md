# Map discount badges and Jimoco photos

Owner added these after the active Saved/chat/shared-post work on 2026-10-23. Finish the active checks, then implement and verify the map changes. These requests extend the current task; they do not authorize a new store submission or version gate change.

## Discount appearance

Owner reports that the mint “최대 20.8%” label obscures other map content when zoomed out. Keep mint as the established discount signal. Preserve the existing category pin and multi-filter identity; add a small mint dot at low zoom. At a suitable closer zoom, show a compact numeric percentage such as `20.8%` next to the dot. Choose the threshold from actual map captures and overlap, reusing the existing zoom/marker policy. Do not add a fixed Jimoco discount or new dependencies.

Detailed card/comparison continues to explain that this is the maximum verified representative-menu saving, with current data and the existing Uber support notice. Preserve explicit accessible meaning while keeping the visual map label numeric only. No extra full-size discount marker or duplicate place pin.

## Jimoco photos

Owner initially requested filling Jimoco's business-profile photos, assuming they were shared with the map place. The later instructions "바로 진행하기전에 뭐가 베스트인지 고민해봐야할듯?" and "지도 진이랑 비즈니스프로필 사진이랑 다른게 맞는거같기도하고..." pause photo writes and automatic photo unification pending this product discussion. Exact branch: Jimoco Cafe & Pasta Austin, 1046A Austin Ave, Coquitlam; `partner:jimoco-coquitlam`, merchant `f97cd7ad-c80b-4f21-aaf5-b422e1bbab45`, order.store ID `ZFgz2GjZSAuhlUYeO1fupA`.

Read-only production RPC verification at 2026-10-23T20:58:52Z confirms the place-to-merchant link and the Austin Ave address. Both profile `avatar_path` and `banner_path` are null. Source inspection confirms map place photography uses `CityPlace.photo`, while merchant profile branding uses `avatar_path` and `banner_path`. `bindBusinessPlaces` links identity and webshop information without copying profile photos to map cards. Evidence: `unknown/output/qa/gling-unified-saved-20261023/jimoco-photo-source-readback.json`.

Initial recommendation, subsequently approved: preserve the same branch identity and profile destination, but allow separate photo selection by purpose. Map representative photos identify the physical venue; profile logo and banner express the business brand/promotion. Reusing an existing image should be possible without automatic cross-overwriting. Do not introduce a new gallery system just to fill these existing slots. Inspect approved real assets first; preserve source, exact branch identity and image hashes. Do not create AI images or present menu/product photos as team-visited venue photography.

Owner then approved the separate-selection recommendation: "오 그거 좋네 그렇게해라". Photo preparation/filling may resume with independent map representative and profile logo/banner selections; do not automatically unify or cross-overwrite them. Reuse the existing independent slots and existing branch link. Use the existing authenticated admin flow and preserve admin/MFA checks, storage validation, normal account ownership and audit records; do not use privileged SQL or service keys as a workaround. Prepare actual reviewable files before asking for genuinely missing authentication input. No new service, paid call, provider or schedule.

## Latest owner choice and verified state

The owner subsequently chose the same photograph currently used for the profile banner as the map representative. Keep the slots independent: this is a deliberate reuse of one original, not automatic synchronization and not a shared mutable logo/banner field. The canonical Austin branch link remains unchanged.

The final source is the official-site food hero, `https://jimoco.kmon.ca/images/hero-bg.webp`, referenced by `https://www.jimoco.ca/`. Original SHA256: `0050025d96ef87d0659155beb37add78e2579f916a6359b7b844dfb9e73c6d93`. This supersedes the earlier `pasta-about.jpg` map candidate. The original is a food promotional photograph; do not call it a storefront/interior, a team-visited photograph or an independently verified specific menu item. Reuse-rights/source limitations remain in the internal asset inventory; do not invent a licence.

Root saved the current site logo and this original food hero as profile branding through the existing normal authenticated admin profile editor. Public anonymous readback at `2026-10-23T21:16:38.146146+00:00` confirmed:

- Avatar: `business-profile/f97cd7ad-c80b-4f21-aaf5-b422e1bbab45/avatar/056630e37923dfcdaed5ef7713aa7759`
- Banner: `business-profile/f97cd7ad-c80b-4f21-aaf5-b422e1bbab45/banner/25c2fced6c4f01f0833540c7bc404940`

These profile data changes are live. The map uses an optional `DeliveryPartner.photo` passed into `CityPlace.photo`; it does not read or overwrite merchant `avatar_path`/`banner_path`. Saying both slots use the same original does not claim identical uploaded bytes after the normal image conversion.

Root viewed the F736 profile and final matching map food thumbnail, the compact numeric discount at closer zoom, and the small mint dot at low zoom. These map client changes are source/private runtime8082 checks in the existing Debug build71 shell, not a new packaged-store release. Their rollout remains held for the owner's release decision; no new source deployment or schema application was performed for this follow-up. Focused matching-photo checks passed55/55.

Evidence: `unknown/output/qa/gling-unified-saved-20261023/jimoco-profile-photos-after.json`, `jimoco-map-photo-runtime.json`, `jimoco-photo-asset-inventory.json`, and `unknown/output/reviews/gling-1.4.3-fullflow-2026-10-23/followup/native-visual-verification.json`. Root's normal admin save preserved existing MFA, storage validation, revision checks and audit; no account/provider/MFA bypass or new upload service was used.
