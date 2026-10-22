# 글링 SNS API 전환 검증 — 2026-10-10

공식 `@gling.app`의 기존 G4/G5/G7/G8/G9/G10 6개 작업에 API 경로를 저장하고 실제 설정·원래 일정·workspace를 다시 확인했다. 새 Instagram/Threads 브라우저 실행이나 API 실패의 화면 우회는 금지한다. 기존 native 예약·승인·hold·불확실 제출은 유지한다.

## 실제 확인

- 공식 Threads 공개글 3개·답글 18개, Instagram 게시물 28개와 글별 인사이트를 읽었다. Instagram 수신 대화 API도 HTTP200으로 연결됐다. 반환된 적격 1:1 대화 0개는 전체 native 받은편지함이 비었다는 뜻이 아니다.
- 미공개 Threads 원글·답글과 Instagram 릴스 컨테이너 3개가 모두 `FINISHED`가 됐다. 프로브는 공개 발행을 거부하며 시험 공개 글·댓글·DM은 보내지 않았다.
- 실제 편집 가능한 HyperFrames 프로젝트의 소스 44개와 manifest/video hash를 검증하고, 현재 CLI로 재열어 원본 index가 유지됨을 확인했다. 1080×1920, H.264/AAC, 26.300초 MP4를 Meta가 받아 처리했다. 해당 영상은 비공개 편집 시안이며 최종 공개 수락본이 아니다.
- 보안·전송 경계·기존 GUI 조정 관련 집중 검사 52개와 기존 calendar 271행 검사가 통과했다. 새 미디어 버킷은 비공개이며 익명 및 authenticated 앱 관리자 접근이 실제 rollback SQL 검사에서 거절됐다. 검증용 저장 파일은 같은 hash 경로만 정리하고 Storage 목록 부재를 확인했다.
- 16:00 정상 정시 precheck가 실제 실행돼 승인 원고 없음으로 발행을 건너뛰었다. 16:15 기존 준비 회차는 API로 공개글 3개·인사이트를 읽고 원장을 갱신했다. API로 현재 native 예약 목록을 확인할 수 없어 보충은 보류했으며 신규 API 원고 등록·발행·SNS GUI 실행은 0건이었다.

## 남은 실제 검증과 운영 한계

첫 승인된 정상 공개 API 발행·답장/공개 결과 재조회, 첫 갱신 가능 시점의 토큰 refresh, 새 완성 HyperFrames 영상의 화면·음성·자막·레퍼런스 적용 및 최종 수락은 아직 관측되지 않았다. 기존 정상 회차에서 각각 검증하며 시험 발송이나 지난 슬롯 보충으로 대신하지 않는다.

Threads DM, native 미래 예약 조회/철회, 정확한 native 태그 자동완성 API는 미검증 상태다. 개인 `@chalkakandupload`는 별도 토큰이 없어 `api_account_not_connected`로 보류하며 공식 계정이나 브라우저로 대체하지 않는다. 글링 앱/admin의 기존 만료된 AAL2 인증은 SNS 토큰과 별개이며 미디어 서버 권한으로 우회하지 않는다.

새 로컬 API 대기 원고의 정시 발행에는 Mac과 Orca가 작동해야 한다. 기존 Meta native 예약의 실행은 별개다. 새 job·worker·daemon·유료 생성 호출은 추가하지 않았다.

자세한 비공개 증거: `/Users/ash/Library/Application Support/gling/operations/social-api-migration-2026-10-10/completion.json`. 실행 계약: `marketing/social-api-automation.md`.
