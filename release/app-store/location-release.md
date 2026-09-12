# Optional location — next native build

The GPS feature is not in the existing build 11. Rebuild after installing expo-location; do not deliver this change as a JavaScript-only update to binaries without that native module.

- Foreground permission only. No Always permission, background location mode, motion permission or Android location foreground service.
- Optional in-app consent; login and writing use one-shot fixes. Public posts share the selected city only. Device coordinates and accuracy are private, unverified safety records.
- Coordinates stop appearing in admin reads after 30 days and are deleted hourly; turning sharing off deletes them immediately. Account deletion cascades.
- App Store Connect: add Precise Location alongside existing Coarse Location, linked to user, App Functionality, not tracking. Apply equivalent Google Play Data Safety changes before distributing the new binary.
- Updated in-app privacy policy and iOS privacy manifest are in source. App Store / Play Console answers are not updated automatically by these files.
- Test Allow Once / While Using / approximate permission, denial, disabled location services, slow GPS, sign-out during a request, cancelled writer, manual city override and account deletion on devices before distribution.
