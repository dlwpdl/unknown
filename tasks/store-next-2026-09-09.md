# 글링 후속 출시 준비 — 2026-09-09

범위는 글링만. 다른 앱의 설정·브라우저·파일은 변경하지 않는다.

- 도메인 후속: public/app-ads.txt에 AdMob 콘솔에서 확인한 게시자 한 줄을 추가했다. e0a24b0 배포 성공: https://github.com/dlwpdl/gling/actions/runs/34425959058 . https://gling.ej-entertainment.com/app-ads.txt 의 HTTPS 200 및 정확한 내용을 확인했다. AdMob 크롤러 검증/공개 스토어 연결/광고 SDK 연결은 별개이며 아직 완료가 아니다.
- Play 현재 주의 필요 3개: 타겟층 및 콘텐츠, 데이터 보안, 아동 안전 표준. 이전 10종 데이터 보안 초안과 새 계정 삭제 URL은 보존했다.
- 사용자에게 실제 대상 연령(18+/16+/13+)을 질문했고 답변 대기다. 기존 개인정보처리방침의 13세 미만 대상 아님을 성인 전용 서비스 결정으로 해석하지 않는다.
- 아동 안전 선언은 공개 정책 URL, 담당 연락처, 인앱 신고 기능, 관련 법규 준수와 당국 신고 확인을 요구한다. 기존 약관은 착취 콘텐츠를 금지하고 신고 기능이 있으나 당국 보고 운영 절차와 담당자 대응 준비가 검증되지 않았다. 자가 확인 체크박스를 임의로 체크/제출하지 않았다.
- 기존 기록상 실제 개인 소셜 로그인·검증용 계정 탈퇴·관리자 경보 수신의 끝까지 검증도 남아 있다. 공개 심사·출시는 실행하지 않았다.

근거: release/admob/README.md, tasks/release-followup-2026-09-08.md, tasks/release-followup-2026-09-09.md, Google Play의 현재 선언 화면.
Google 공식 안내: https://support.google.com/admob/answer/9363762?hl=en 및 https://support.google.com/googleplay/android-developer/answer/14747720?hl=en .
