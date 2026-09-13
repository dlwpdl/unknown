# 댓글 스레드와 알림 — 2026-09-12

사용자 요청: 댓글·대댓글 좋아요, 내 글 반응, DM 요청, 모임 가입 요청, 관심 태그, 주변 모임 소식을 알림과 연결하고 종류별로 끌 수 있게 한다. 향후 모임장 홍보 알림도 같은 수신 설정을 따른다.

현재 댓글 좋아요와 인앱 알림 테이블/일부 트리거가 있다. 이를 재사용한다. 알림 종류마다 별도 서비스나 새 상태 관리 라이브러리를 만들지 않는다. 모바일 푸시에는 Expo 공식 notifications 모듈을 사용한다. 실제 발송 자격 증명과 기기 수신은 별도 검증하며, 없는 연결을 완료로 표시하지 않는다.

동작:
- 댓글 아래 답글을 펼친다. 답글에도 같은 좋아요·신고·프로필 동작이 있다. 답글에 답해도 들여쓰기는 한 단계로 유지하고 누구에게 답하는지 표시한다.
- 알림 분류: `post_likes`, `comment_likes`, `replies`, `direct_requests`, `messages`, `meetups`, `interests`, `nearby`.
- 앞의 활동 알림 6개는 기본 켬. 관심 태그·주변 모임 소식은 기본 끔, 명시적으로 설정한 계정만 수신한다. `push_enabled`는 기본 끔이며 휴대폰 권한 허용과 함께 사용자가 켠다. 인앱 목록과 OS 푸시는 같은 종류별 설정을 따른다.
- 관심사는 기존 카테고리 ID와 해시태그로 저장한다. 주변 지역은 현재 저장한 선호 도시를 기준으로 하며 GPS 권한을 새로 요구하지 않는다.
- 내 행동 알림, 차단한 상대, 비활성 계정은 제외한다. 좋아요 취소/재등록으로 중복 알림을 만들지 않는다. 꺼진 설정은 서버에서 검사한다.
- 안전·계정 제재 기록과 관리자 감사/전체 콘텐츠 모니터링은 ADR-0001을 유지한다. 개인 알림 설정으로 안전 검토가 꺼지지 않는다.
- 기존 알림 내용에는 실제 메시지 본문을 넣지 않는다. 푸시 토큰은 본인 등록/해제와 서버 발송만 허용하며 로그아웃·계정 삭제 시 해제한다. 푸시 이동 경로는 허용된 앱 내부 경로만 처리한다.
- 홍보는 현재 출시 비활성 상태를 유지한다. 실제 운영용 홍보가 활성화되는 사건만 향후 `nearby` 수신 설정과 연결한다. 이번 작업으로 실제 회원에게 시험 홍보를 발송하지 않는다.

DB/API 계약 (기존 API는 호환 유지):
- `create_thread_comment(p_post_id uuid, p_body text, p_reply_to_id uuid default null) -> uuid`; 저장 필드 `parent_id`는 루트 댓글, `reply_to_id`는 직접 답하는 댓글. 기존 `create_comment(uuid,text)`는 루트 댓글 동작 유지.
- `get_comment_thread_page(p_post_id uuid, p_parent_id uuid default null, p_before_created timestamptz default null, p_before_id uuid default null, p_limit integer default 30)` → 기존 PublicCommentRow 필드 + `parent_id`, `reply_to_id`, `reply_to_nickname`, `reply_count`. 루트/답글 모두 최신순 키셋 페이지. 삭제/차단된 본문·부모 정보 비공개.
- `get_notification_preferences()` → 8개 분류 boolean + `push_enabled`, `interest_tag_ids` integer[], `interest_hashtags` text[]. 없는 행은 기본값 반환.
- `update_notification_preferences(p_preferences jsonb)` → 같은 전체 설정. 허용 키/유형만 검증하고 본인 데이터만 변경한다.
- `notifications.category`는 위 8개 또는 `system`; 기존 `message` + `target_type=user`는 DM 요청/응답, 실제 `message` 대상은 새 메시지로 분류한다.

구현 순서: (1) 도시 화면 검증/커밋 마무리, (2) DB 댓글/알림과 UI를 위 계약으로 병렬 구현, (3) 기기 푸시 등록·발송 연결, (4) RLS·수신 거부·차단·중복·페이지네이션·실제 UI 검증 후 통합. SQL 담당은 0040 댓글과 인앱 알림만 작성하고, 푸시 연결은 0041로 분리한다. 공개 웹에 관리자 코드가 포함되지 않는 기존 검사도 유지한다.

검사: `npm run typecheck`, `npm run lint`, `npm test`; 로컬 Supabase에서 `supabase test db` (사용자 데이터 reset 금지); iOS/Android 빌드와 테스트 기기 알림 열기/거부/로그아웃 검증. 테스트 발송은 소유자가 쓰는 테스트 기기만 대상으로 한다.

UI 근거: Mobbin의 [Threads 알림 설정](https://mobbin.com/screens/535cb43b-9c29-4722-95f7-a3493f50c9de)을 실제 열어 종류별 제어를 확인했다. 팔로우 시스템은 현재 글링에 없으므로 전체/팔로잉 하위 단계는 만들지 않고 기존 설정 화면의 Switch를 사용한다. BrandKit의 기존 Gling 검색은 결과가 없고 Kroma는 API 키 누락으로 사용 불가하다. Pinterest 보조 검색은 별도 확보했다.

푸시 공식 자료: [Expo SDK 57 Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/), [설정](https://docs.expo.dev/push-notifications/push-notifications-setup/), [발송 및 영수증](https://docs.expo.dev/push-notifications/sending-notifications/).

## 현재 반영 상태

- 운영 DB에0040/0041을 적용했다. 개인 알림은 `user_notifications` 보안 뷰를 사용하여 관리자 계정에서도 수신 거부·차단을 적용한다. 관리자 원본 전체 조회는 유지한다.
- 댓글 알림은 `get_comment_thread_context(post_id, comment_id)`로 오래된 루트·답글을 직접 연다. 삭제/차단 대상은 반환하지 않는다.
- `push-notifications` Edge Function은 배포했지만 서버 발송 secret/스케줄러는 아직 설정하지 않았다. 미설정 호출은 HTTP503 `PUSH_NOTIFICATIONS_NOT_CONFIGURED`로 종료한다. 배포 후 등록 기기0, 대기 발송0을 확인했으며 실제 회원에게 시험 알림을 보내지 않았다.
- 기존 Expo 계정 `caydenvove`(eun530k 로그인)에 글링 프로젝트를 생성했다: `3889cb42-940a-469d-b975-b5c9a4c6bfc5`, [프로젝트](https://expo.dev/accounts/caydenvove/projects/gling). 발송 자격 증명을 확인하기 전에는 앱의 `EXPO_PUBLIC_EAS_PROJECT_ID`를 설정하지 않아 푸시 켜기가 비활성이다.
- 사용자가 Firebase 관리 계정으로 gling@ej-entertainment.com을 지정했다. 이 계정에 글링 전용 `gling-5ab6a` 프로젝트와 Android `com.dlwpdl.gling`을 생성했다. 콘솔에서 Spark 무료($0/월)를 확인했으며 결제 계정을 연결하지 않았다. Rottery는 기존 별도 프로젝트로 유지한다. Google Analytics와 Gemini 선택 기능은 끈 상태로 생성했다. [Firebase 공식 요금 안내](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)에 따라 FCM은 무료이며 다른 유료 서비스와 기존 Supabase 비용은 별개다. Android 구성 파일은 저장소 밖의 비공개 글링 운영 폴더에 보관했다.
- Android FCM v1 API 활성화와 Expo 발송 키 연결을 확인했다. 전용 서비스 계정 `gling-expo-push`에는 `roles/firebasecloudmessaging.admin`만 부여했다. Google OAuth 인증 후 FCM `validate_only: true` 요청이 HTTP200으로 통과했다. 실제 발송 없이 서버 권한만 확인한 결과다.
- iOS APNs 키 `4866V2G797`을 Apple 팀 `P3X3452TDZ`에서 생성하여 Expo 글링 프로젝트의 `com.dlwpdl.gling`에 할당하고 콘솔에서 재확인했다. 환경은 Sandbox & Production, Apple에서 이 조합에 제공하는 범위는 Team Scoped이다. 기존 `F5N57692CC` 키는 Sign in with Apple용으로 확인했으며 변경하지 않았다. 앱 ID의 꺼져 있던 Push Notifications도 켰다. Apple 안내에 따라 다음 실기기·스토어 빌드에서 글링 프로비저닝 프로파일 갱신이 필요하다.
- 앱 빌드의 EAS 프로젝트 ID/Android 구성 파일 반영, 서버 발송 secret·스케줄러, 실제 테스트 기기 수신·수신 거부·로그아웃 검증이 남았다. 현재 앱의 푸시 켜기는 아직 비활성이다. 동시 진행 중인 로고 작업과 충돌하지 않게 이번 콘솔 설정 작업에서는 공유 네이티브 폴더, `app.json`, `animated-icon.tsx`, 583E 시뮬레이터와 3100 스트림을 조작하지 않았다. 운영 앱 배포/스토어 업로드도 하지 않았다. 비밀 키는 저장소 밖에서만 보관하며, 비밀 없는 설정 검증 기록은 `output/qa/notifications-2026-09-12/push-credentials.json`에 남겼다. [공식 FCM 설정](https://docs.expo.dev/push-notifications/fcm-credentials/)을 따른다.
- unregister RPC의 null token은 현재 본인 auth session 등록만 전부 해제한다. 로컬 토큰 저장 실패의 영향을 없앴으며, 등록 해제 실패 시 로그아웃을 중단해 재시도를 안내한다.
- 주변 모임은 선호 도시에 새로 등록된 모임만 대상으로 한다. 아직 없는 유료 홍보 활성화 이벤트는 연결하지 않았다.

검증: 로컬 SQL532개, 전체JS110개, 타입·lint 통과. 공개웹 관리자코드 제외 검사 통과. iOS/Android Release 빌드 및 실제 에뮬레이터 알림설정 화면 확인. iOS 설정 OFF 재시작 유지/ON 복원 확인. 자세한 출처·한계는 `output/qa/notifications-2026-09-12/verification.json` 및 `web-comment-qa.md`에 보존했다. 실제 푸시 수신은 미검증이다.
