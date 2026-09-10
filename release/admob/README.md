# 글링 AdMob 등록

2026-09-09 등록 및 저장 확인. Publisher ID: `pub-2361293253164911`.

| 플랫폼 | 앱 이름 | AdMob App ID | 피드 광고 단위 | Ad unit ID |
|---|---|---|---|---|
| iOS | 글링 | `ca-app-pub-2361293253164911~5982097137` | `gling_feed_native_ios` | `ca-app-pub-2361293253164911/5616099773` |
| Android | 글링 | `ca-app-pub-2361293253164911~5342813202` | `gling_feed_native_android` | `ca-app-pub-2361293253164911/4669015468` |

위 ID는 앱에 들어가는 공개 설정값이며 로그인 자격 증명이 아니다.

## 등록 상태

- 두 플랫폼 모두 **Unpublished**로 등록했다. 공개 스토어 연결 전이므로 승인 상태는 `Requires review`, 표시 상태는 `Limited ad serving / Add store to lift limit`다.
- 각 앱에 `Native advanced` 광고 단위를 하나씩 만들었다. 글 사이에 놓는 피드 광고용이다.
- `Partner bidding`은 선택하지 않았다. 기본값인 `Image + Video`, `Google optimized → All prices`를 유지했다.
- 이 작업은 콘솔 등록까지다. 광고 SDK·광고 요청·실제 송출은 아직 앱에 연결하지 않았다. 캠페인과 미디에이션 그룹은 각각 0개다.
- 앱의 실제 bundle/package는 두 플랫폼 모두 `com.dlwpdl.gling`이다. 미출시 등록 화면은 이름과 플랫폼만 받아서 AdMob의 `Package name or store ID` 칸은 현재 `—`다. 공개 출시 후 기존 등록 앱에 스토어를 연결한다. 새 앱을 중복 생성하지 않는다.

AdMob은 미출시 앱을 미리 등록할 수 있다. Google Play 비공개 테스트 링크는 공개 스토어 연결에 사용할 수 없다. 공개 스토어 연결과 앱 준비 상태 검토를 마쳐야 한다. [Google 앱 등록 안내](https://support.google.com/admob/answer/9989980?hl=en)

## 도메인 준비 후 app-ads.txt

AdMob 계정의 `Set up app-ads.txt` 안내에서 확인한 정확한 내용:

```text
google.com, pub-2361293253164911, DIRECT, f08c47fec0942fa0
```

글링 전용 주소는 `https://gling.ej-entertainment.com`이다. `public/app-ads.txt`를 Expo 정적 내보내기로 **해당 호스트의 루트 `/app-ads.txt`**에 게시한다. `/gling/app-ads.txt`처럼 프로젝트 하위 경로에 두는 것으로 루트 파일을 대신하지 않는다. 공통 도메인 루트와 다른 앱은 변경하지 않는다. 파일 게시와 AdMob 크롤러의 검증 완료는 별개다.

Google Play의 개발자 웹사이트와 App Store의 Marketing URL을 같은 글링 도메인으로 연결하고, 공개 스토어 등록을 AdMob에 연결한 뒤 app-ads.txt 검증 상태를 확인한다. AdMob은 스토어에 등록된 웹사이트의 호스트를 기준으로 파일을 찾는다. [Google app-ads.txt 설정 안내](https://support.google.com/admob/answer/9363762?hl=en)

## 앱 연결 전에 남은 일

1. 이용 연령과 광고 개인정보·동의 흐름을 확정하고 스토어 신고 내용을 맞춘다.
2. SDK를 연결할 때는 공식 테스트 광고로 검증한다. 광고 표시와 AdChoices를 유지하고 실제 광고를 테스트 목적으로 누르지 않는다. [Google 네이티브 광고 안내](https://support.google.com/admob/answer/6239795?hl=en)
3. 피드 배치와 동작 검증 후 실제 송출 여부를 결정한다. [현재 광고 배치 시안](../../output/design/gling-feed-ad-placement.html)의 첫 5개 글 뒤, 이후 10개 간격은 제안이며 SDK에 적용된 정책이 아니다.

## 확인 결과

- 등록 전 전체 앱 목록을 숨김 포함으로 확인해 글링이 없는 것을 확인했다.
- 생성 후 각 플랫폼의 광고 단위 목록을 새로고침해 이름·ID·`Native advanced`와 `1 - 1 of 1`을 확인했다.
- 전체 앱 목록에서도 글링 iOS·Android가 각각 1개 광고 단위를 가진 상태로 저장된 것을 확인했다.
- 기존 Rottery 앱과 광고 단위는 수정하지 않았다. 결제·계정 설정·외부 이메일 발송도 하지 않았다.
