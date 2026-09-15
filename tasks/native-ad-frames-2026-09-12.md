# iOS 네이티브 광고 자산 경계 실측 — 2026-09-12

후속 상태: 아래 내용은 `0875e7…` 번들의 실패 원본이다. 최종 `f71d82…` 번들에서 footer marginBottom 1pt 적용 후 SDK 검증기 통과와 네이티브 CGRectContainsRect 18/18 true를 확인했다. [최종 QA 기록](membership-native-qa-2026-09-12.md), [최종 프레임](../output/qa/ads-final-2026-09-12/native-ad-frames.json), [설치본 출처](../output/qa/ads-final-2026-09-12/provenance.json)를 참고한다.

**확인된 경계 초과 자산은 `callToActionView`다.** 화면에 보이는 광고의 CTA 하단은 `401.6666564941406pt`, `GADNativeAdView` 하단은 `401.333251953125pt`로 **0.333404541015625pt** 넘는다. headline/body/icon/advertiser/media는 모두 안에 있다. 같은 프로세스의 광고 3개에서 CTA만 하단을 넘었고, 22초 간격 재측정에서도 동일했다. 앱 코드·SDK 설정·뷰 배치 변경이나 광고 클릭 없이 측정했다.

## 설치본·측정 방법

- 기기: `583E7BFD-5CB4-42EC-B15C-1D4D5986FA39`, iPhone 16 Pro Max / iOS 26.5.
- 앱: `com.dlwpdl.gling`, 1.0.0 (11), PID `3919`. 앞선 새 카드 QA와 **같은 실행 프로세스**다.
- main.jsbundle SHA-256: `0875e7b41079fa3cc261d68ac993ab8a68656687ab8223765adebc4963b2510a`.
- 실행 파일 SHA-256: `30fedb8d12c43d3e63f7fd3b7240f475aa607c182f55e3cd073187ddc2a6c48e`.
- 측정: **13:56:54 / 13:57:16 PDT** (20:56:54 / 20:57:16 UTC). 완료 후 설치 파일 해시를 다시 확인했다.
- LLDB로 현재 PID에 연결해 main thread에서 UIKit getter만 조회했다. 창의 subviews를 순회해 `GADNativeAdView` 3개를 찾았다(총 1,982개 뷰 방문).
- 각 등록 자산의 실제 `bounds`를 **`[asset convertRect:asset.bounds toView:nativeAdView]`**로 변환했다. Release 디버그 정보의 `CGRect` 타입 충돌 때문에 동일 메서드를 `NSInvocation`과 런타임 method signature로 호출했다. 32바이트 CGRect 반환형을 확인하고 네 개의 double을 읽었다. 좌표를 임의로 추정하거나 스크린샷 픽셀에서 역산하지 않았다.
- 숫자 비교·초과량 계산은 추출 후 호스트 Python에서 수행했다. getter/좌표 변환 외에 앱 메서드 호출, 레이아웃 강제 갱신, 속성 setter, SDK 검증기 비활성화는 하지 않았다.
- 두 측정 후 `process detach` 성공, PID 3919가 정지 상태가 아닌 상태로 계속 실행되는 것을 확인했다.

## 현재 화면에 보이는 광고

`GADNativeAdView` 주소 **`0x15afa2300`**. 창 기준 rect는 `(16, 277.9999898274741, 408, 401.333251953125)`다.

- native ad bounds: **`(0, 0, 408, 401.333251953125)`**.
- native ad frame: `(0, 0, 408, 401.333251953125)`.
- 바깥 `RNGoogleMobileAdsNativeView` bounds도 동일하다. 현재 GAD 뷰 원점에 padding/border만큼의 inset은 관찰되지 않았다.
- 아래 rect 표기는 **x, y, width, height**, 단위 pt다. 표의 일부 값만 소수점 9자리로 줄였으며 원본 JSON에는 정밀도를 보존했다.

| 자산 | nativeAdView 기준 변환 rect | 하단 maxY | 경계 결과 |
| --- | --- | --- | --- |
| headlineView | `(0, 26, 408, 26)` | 52 | 안쪽 |
| bodyView | `(0, 60, 408, 44)` | 104 | 안쪽 |
| iconView | `(0, 363.666656494, 32, 32)` | 395.666656494 | 안쪽 |
| advertiserView | `(40, 369.999989510, 108.666671753, 19)` | 388.999989510 | 안쪽 |
| callToActionView | `(338.333343506, 357.666656494, 69.666656494, 44)` | **401.666656494** | **하단 0.333404541pt 초과** |
| mediaView | `(0, 120, 408, 229.333251953)` | 349.333251953 | 안쪽 |

CTA의 오른쪽 끝은 정확히 `408pt`라 수평 초과는 없다. 여섯 자산 모두 실제 GAD 뷰의 descendant다. headline/body/icon/advertiser/CTA는 Fabric에서 GAD 뷰 아래 직접 배치됐고, media만 `RNGoogleMobileAdsMediaView → GADMediaView` 계층을 가진다. 따라서 이번 실측에서는 **자산이 트리 밖에 등록된 경우가 아니라, descendant의 변환 rect가 부모보다 낮게 끝나는 경우**다.

`adChoicesView` 사용자 지정 속성은 nil이었지만 자동 SDK 정보 아이콘은 앞선 원본과 현재 화면에 보인다. nil 속성만으로 AdChoices가 누락됐다고 해석하지 않는다.

## 화면 밖에 마운트된 광고와 재측정

| GAD 뷰 주소 | 창 기준 y | native ad 높이 | CTA 하단 | 하단 초과 |
| --- | --- | --- | --- | --- |
| `0x15afa2300` (화면 안) | 277.999989827 | 401.333251953125 | 401.6666564941406 | **0.333404541015625** |
| `0x15afa3c00` (화면 밖) | 4096.333485921 | 401.33349609375 | 401.6666564941406 | **0.333160400390625** |
| `0x15c66ed00` (화면 밖) | 7826.999989827 | 401.3330078125 | 401.6666564941406 | **0.333648681640625** |

3개 모두 CTA만 넘고 나머지 자산은 안에 있다. 재측정에서 주소·bounds·각 자산 변환 rect가 첫 측정과 모두 일치했다. 측정 시점에만 잠깐 발생한 미완성 레이아웃이라는 근거는 없다.

## 소수 높이 이슈와의 관계·판정 한계

SDK 저장소의 [이슈 #700](https://github.com/invertase/react-native-google-mobile-ads/issues/700)은 **old architecture의 사용자 재현 보고**다. NativeAdView 소수 높이에서 같은 경고가 나고 정수 올림을 임시 해결책으로 제시하지만, 현재 Fabric/16.3.4 구현의 확정 원인이나 공식 해결 보장은 아니다.

이번에도 native ad와 media 높이가 소수이고 CTA 하단이 약 1/3pt 넘는 것을 실제 확인했다. 440pt 창과 1320px 캡처의 비율에서는 약 1px에 해당한다. **소수 높이·픽셀 정렬을 조사할 근거는 생겼지만, 어느 레이아웃 계산에서 차이가 생겼는지와 정수 올림으로 해결되는지는 아직 검증하지 않았다.** 현재 경고와 일치하는 구체적 자산/초과량을 확인한 단계다. 코드 수정이나 A/B 레이아웃 실험을 하지 않았다.

진단 전 SDK 경고 팝오버가 다시 나타난 화면을 캡처했다. 진단 후 캡처에는 팝오버가 보이지 않지만, 두 실측에서 CTA 초과가 유지되어 이를 경고 해결 증거로 사용하지 않는다. 이 진단 중 팝오버 Dismiss·광고 CTA·AdChoices·미디어 재생 버튼을 누르지 않았다.

## 원본·재현 자료

- [첫 측정 JSON](../output/qa/native-ad-frames-2026-09-12/native-ad-frames.json), [재측정 JSON](../output/qa/native-ad-frames-2026-09-12/native-ad-frames-recheck.json).
- [실행 가능한 LLDB 조회 명령](../output/qa/native-ad-frames-2026-09-12/snapshot.lldb): 기록된 PID 3919 전용. 재실행 전 현재 앱 PID를 반드시 확인한다.
- [첫 LLDB 출력](../output/qa/native-ad-frames-2026-09-12/lldb-frames-raw.txt), [재측정 LLDB 출력](../output/qa/native-ad-frames-2026-09-12/lldb-frames-recheck.txt), [해시·시각·비교 결과](../output/qa/native-ad-frames-2026-09-12/provenance.json).
- [진단 전 화면](../output/qa/native-ad-frames-2026-09-12/before-diagnostic.png), [진단 후 화면](../output/qa/native-ad-frames-2026-09-12/after-diagnostic.png). 실제 네이티브 PNG 원본이며 편집하지 않았다.
- API 참고: [LLDB attach/detach·expression](https://lldb.llvm.org/use/map.html), [Google NativeAdView 참조](https://developers.google.com/admob/ios/api/reference/Classes/GADNativeAdView).

사용자에게 [광고 시안](../output/qa/ads-location-card-2026-09-12/ios-ad-card.png)과 [짧아진 위치 카드 시안](../output/qa/ads-location-card-2026-09-12/settings-nearby-collapsed.png)을 실제 앱 화면으로 보여드렸다. 사용자는 시뮬레이터에서 본 디자인에 긍정적으로 답했다. 현재 시각 디자인을 유지하고, 이번 진단은 광고 자산 경계 문제에 한정한다. 관리자 서버·54321 설정은 별도 담당자 작업이며 여기서는 변경하지 않았다.
