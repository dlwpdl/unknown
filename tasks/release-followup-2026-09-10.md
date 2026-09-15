# 글링 iOS 심사 제출 — 2026-09-10

사용자의 제출 지시에 따라 iOS `1.0.0 (6)`을 정식 App Review에 제출했다. 제출 시각은 2026-09-10 14:58:31 PDT / 21:58:31 UTC이며, 상태는 `WAITING_FOR_REVIEW`다. 브라우저의 `1개의 항목 제출됨`·`심사 대기 중` 표시와 인증된 App Store Connect API의 `submission.inFlight=true`를 확인했다.

- 앱: `6809273242`, 버전: `1fe513b3-ec8d-4b00-bc4e-09c6a5087088`.
- 빌드: `27cef51f-ac69-4ff8-bed3-76a94781dc76`, `VALID`.
- 심사 접수: `3ba5f0c6-dc4d-44e4-9c85-33b2609329fc`.
- 제출 항목은 iOS 앱 1개이며, 구독 초안은 포함하지 않았다.
- `MANUAL` 출시 설정을 확인했다. 현재 승인·공개 출시가 완료된 상태는 아니다.

제출 전 기존 CLI 검사에서 차단 오류 0, 경고 18을 확인했다. 경고는 별도 구독 초안의 이미지·메타데이터·가격 범위와 지원/마케팅 URL의 사이트 루트 사용에 관한 것이었다. Apple의 실제 제출 검사를 통과했다. 계정 삭제 안내의 기존 GitHub URL과 현재 도메인 URL은 모두 새 도메인의 계정 삭제 페이지로 연결되며 HTTP 200이었다.

TestFlight는 기존 `Gling Internal` 그룹에 빌드 6과 내부 테스터 1명이 연결되어 있었고, 브라우저에서 소유자 계정의 `초대됨` 상태를 확인했다. 이번 심사 제출 작업에서는 중복 업로드·초대를 하지 않았다. 초대 수락과 실기기 설치는 확인하지 않았다. CLI의 `internalBuildState=PROCESSING`과 브라우저의 `제출 준비 완료` 표시는 별도로 기록하며, 설치 완료로 해석하지 않는다.

심사 영상 첨부는 현재 양식에서 선택사항이었고 별도 영상 요청은 없었다. 기존 실제 스크린샷 3장과 심사용 계정·접근 안내를 사용했다. 영상은 추가하지 않았다. [Apple 제출 절차](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app), [심사 보조 첨부 자료](https://developer.apple.com/documentation/appstoreconnectapi/app-store-review-attachments).

실제 소셜 계정의 로그인·탈퇴와 운영 알림 수신 확인 등 공개 출시 전 후속 검증은 [기존 기록](release-followup-2026-09-09.md)을 따른다. 이번 작업은 심사 제출이며, 외부 베타 배포나 상업 출시를 시작한 것은 아니다. SNS는 기존 초안 전용 방침을 유지한다.
