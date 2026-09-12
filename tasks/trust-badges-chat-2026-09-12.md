# 인증 배지와 첫 대화 안내 — 2026-09-12

사용자 기준: Lv1 이메일 인증, Lv2 전화번호 실명 인증, Lv3 신분증과 본인 촬영 대조. Lv1은 별도 인증 마크 없음, Lv2는 간단한 체크마크, Lv3는 특별 마크. 실명 미인증 상대와 새 1:1 대화를 시작할 때 만남·개인정보·금전 요청에 주의하도록 알린다.

기존 `profiles.verification_level`과 공통 `TrustBadge`를 재사용한다. 프로필·미니 프로필·글·댓글·대화에 공통 적용한다. Lv2의 복잡한 L2 원형 장식을 기존 expo-symbols 체크 아이콘으로 바꾸고 Lv3의 글링 전용 마크는 유지한다. 화면 낭독기는 단계와 인증 범위를 읽는다.

대화 요청 단계와 메시지 목록 시작 부분에 안내를 한 번씩 표시한다. 상대 레벨이 2 또는 3인 경우와 그룹 대화에는 미인증 경고를 표시하지 않는다. 서버 메시지를 생성하거나 알림을 보내지 않는다. 대화 허용·차단·신고·안전 모니터링 로직을 변경하지 않는다.

현재 실제 동작은 소셜 로그인 후 Lv1이며 이메일 확인 여부만으로 등급을 부여하는 흐름은 아직 없다. 전화번호 실명·신분증/촬영 검증 업체도 미연결이다. 따라서 소셜 로그인·자기 입력 이름·SMS 번호 소유만으로 실명 인증을 부여하지 않는다. 실제 인증 수집·판정 연동은 업체와 대상 국가 확인 후 별도로 구현해야 한다. 기존 Lv1 화면을 이메일 인증 완료라고 허위 변경하지 않는다.

구현 범위: `src/components/trust-badge.tsx`, `src/components/chat-room.tsx`, `src/i18n/ko.ts`. React Native/Expo 57, 기존 테마·번역·아이콘을 사용한다. `scripts/relationship-ui.test.mjs`에 조건별 회귀 검사를 추가하고 기존 `scripts/trust-levels.test.mjs`로 단계 매핑을 확인한다. 명령: `npm run typecheck`, `npm run lint`, `npm test`. 네이티브/웹 export 및 배지·대화 화면 확인을 포함한다.

디자인 근거: BrandKit의 글링 항목은 앞선 조사에서 없어 저장소 테마를 사용한다. Mobbin에서 실제 확인한 [Fiverr 대화](https://mobbin.com/screens/e8cc9b07-958f-408f-8f78-126f036abbf6)의 작은 상단 안전 안내, [Vestiaire Collective 대화](https://mobbin.com/screens/3c373635-7634-4552-b66c-298c89500d3d)의 메시지 앞 주의 문구를 참고했다. Pinterest는 보조 검색으로만 사용했다. Kroma는 API 키 미설정 상태다. 새 의존성·유료 서비스·DB 변경은 없다.

검증: 타입·린트·Node 89/89 통과. 새 주의 안내 검사는 수정 전 실패·수정 후 통과했고, 직접/그룹·요청/활성/종료/거절/취소·인증 1/2/3의 30개 조합을 확인했다. iOS 시뮬레이터/실기기 대상 Release와 Android 서명 APK/AAB, 공개 웹 export 및 관리자 코드 제외 검사도 통과했다. 실제 인증 업체 연동·이메일 인증 조건 변경·새 스토어 배포는 완료 범위에 포함하지 않는다.

최종 iOS 설치본에서 기존 대기 중인 1:1 요청을 읽기만 해 주의 안내 표시를 직접 확인했다. 요청 수락·취소·새 메시지·인증 등급 변경은 실행하지 않았다. 원본 캡처는 비공개 `~/Library/Application Support/gling/operations/existing-pending-chat-safety-2026-09-12.png`에 보관한다.
