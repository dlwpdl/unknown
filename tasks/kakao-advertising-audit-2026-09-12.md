# 카카오 사업자·글링 광고 연결 점검 — 2026-09-12

확인 방식: 기존 Gling Orca 폴더의 실제 콘솔, 제품 범위 메일·데브톡 이력, 현재 앱 소스, 운영 HTTPS 파일. 설정·과금·광고 집행·서류 제출·외부 메시지는 변경하지 않았다. 다른 작업자의 코드·문서는 보존했다.

| 항목 | 직접 확인한 상태 | 남은 단계 |
|---|---|---|
| 카카오 해외 사업자 | 앱 1558027, 해외 사업자 Eunseok Choi, D-U-N-S 등록, 비즈 앱. 신청 자격 확인 2026.09.10 완료 | 기존 등록을 다시 신청하지 않음 |
| 카카오 이름·생년월일 | 같은 날 콘솔에서 name/birthday/birthyear ‘권한 없음’. 비즈니스 정보·개인정보 동의항목 심사 상태 공란 | 기존 자료의 추가 심사 재사용 가능 여부는 담당자 확인 필요. 빈 상태만으로 과거 미제출을 단정하지 않음 |
| AdMob 계정 | eun530k 계정의 홈에 “Your account is approved”, 지급 프로필 완료 | 계정 승인은 앱별 준비 상태 승인과 별개 |
| 글링 AdMob iOS·Android | 각 1개 Native advanced 광고 단위 정상. 둘 다 Requires review / Limited ad serving / Add store to lift limit, 스토어 ID 미연결 | 지원되는 공개 스토어 등록 연결 → 앱 준비 상태 검토 |
| app-ads.txt | https://gling.ej-entertainment.com/app-ads.txt HTTP 200, 기존 Publisher ID 정확히 일치 | AdMob 화면은 “No ad requests with app-ads.txt yet”, 크롤러 표 비어 있음. 파일 게시 성공을 크롤러 검증 완료로 표현하지 않음 |
| 앱 내 광고 | 현재 package.json·Expo 설정·iOS Podfile/Info.plist·Android manifest/Gradle·src에서 AdMob SDK/앱 ID/광고 요청 연결 없음 | SDK·동의·피드 배치·공식 테스트 광고 검증, 새 네이티브 빌드와 스토어 광고 선언. 이번 조회에서 구현/송출하지 않음 |
| Google Ads — eun530k | 기존 계정 883-435-1957 ‘응자’, 2019.07.27 해지, 현재 결제수단 청구 불가 알림, 캠페인 일시중지. Promotions에 등록 내역 없음 | 글링 홍보용 활성 계정·사용 가능한 크레딧이 확인되지 않음. 재활성화·결제·광고 집행 없음 |
| Google Ads — (소유자 계정) | 해당 이메일로 계정 선택 화면을 열었고 선택할 계정 목록이 비어 있음 | 새 계정을 만들지 않음. 확인하지 않은 다른 이메일/쿠폰의 존재까지 부정하지 않음 |

## 광고 단위 대조

- Android: gling_feed_native_android / ca-app-pub-2361293253164911/4669015468
- iOS: gling_feed_native_ios / ca-app-pub-2361293253164911/5616099773
- app-ads.txt: google.com, pub-2361293253164911, DIRECT, f08c47fec0942fa0
- AdMob 홈의 108건 요청은 계정 전체 집계이며 글링 실적으로 배분하지 않았다. 글링 앱에서 정상 광고 노출을 관측했다고 보고하지 않는다.
- Google Ads 전환 연결의 실제 이벤트 발화는 확인하지 않았다. 현재 앱에 Firebase/Google Ads SDK 의존성은 없으며 기존 자체 운영 통계와 광고 전환 측정을 혼동하지 않는다.

## 기존 사업자 제출 근거의 범위

사용자는 캐나다 사업자 번호와 해외 사업자 자료를 이미 제출했다고 재확인했다. eun530k Gmail에서 2026.08.31 D&B 발급 안내와 콘솔의 해외 사업자 등록을 확인했다. (소유자 계정) Gmail의 9/1 이후 개발자 관련 검색과 eun530k Gmail의 개발자/D-U-N-S 검색 및 8/25 이후 카카오 관련 검색에서는 추가 권한 승인·반려 메일을 찾지 못했다. 무관한 메일 내용은 보고에 저장하지 않았다.

카카오 SSO로 접근한 기존 데브톡 계정 은석0375의 받은·보낸·보관 메시지 목록은 모두 비어 있었다. 이 범위에서 심사 접수증을 찾지 못한 것이며, 다른 수신함이나 별도 제출 경로의 과거 기록까지 없다고 단정할 수 없다. 콘솔의 등록 완료와 추가 권한 승인을 분리해 기록한다.

기존 자료 재사용 및 실제 접수 이력을 묻는 비공개 문의 초안을 Git 바깥 `~/Library/Application Support/gling/operations/kakao-extra-permissions-inquiry-2026-09-12.md`에 준비했다. 발송하지 않았다.

## 안내 문구 해석과 공식 근거

AdMob의 “All monetized apps…”는 지원되는 스토어의 앱 등록을 연결하고 앱 검토를 받아야 광고 제한을 해제할 수 있다는 안내다. TestFlight/내부 테스트만으로 공개 스토어 연결을 대신하지 않는다. “If you recently signed up…”는 신규 계정의 지급 프로필 및 계정 확인 조건을 설명한다. 현재 확인한 계정은 이미 승인 완료다. 광고비 결제를 요구하는 문구가 아니다.

- [Google 앱 등록 및 검토](https://support.google.com/admob/answer/9989980?hl=en)
- [Google app-ads.txt 설정](https://support.google.com/admob/answer/9363762?hl=en)
- [카카오 현재 앱 설정·추가 기능 신청](https://developers.kakao.com/docs/ko/app-setting/app)
- [카카오 비즈니스 정보 심사 FAQ 및 비공개 문의 경로](https://devtalk.kakao.com/t/faq/132272)

확인 요청에 따른 운영 점검이며 새 광고 집행·계정 생성·앱 광고 기능 구현을 완료한 작업이 아니다. 유료 행동에는 사용자의 별도 승인이 계속 필요하다.
