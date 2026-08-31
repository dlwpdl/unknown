# Implementation Plan: 글링 Supabase 백엔드 v1

## Overview

기존 만남 중심 SQL 초안을 일상 공유 중심 스키마로 줄이고, RLS와 정책 테스트를 먼저 완성한 뒤 Expo 클라이언트를 연결한다.

## Architecture Decisions

- 별도 API 서버 없이 Supabase Data API와 Postgres RPC를 사용한다.
- 하루 한 편과 신고 대상 확정처럼 우회되면 안 되는 규칙만 DB 함수/트리거로 강제한다.
- 관리자는 service-role 키가 아니라 서버가 발급한 `app_metadata.role` 클레임으로 판정한다.
- 이미지 바이너리는 DB가 아니라 비공개 Storage에 두고 DB에는 경로만 저장한다.

## Dependency Graph

`스키마·RLS → pgTAP 정책 검증 → Supabase 클라이언트 설정 → Auth → mock 교체`

## Phase 1: Database Foundation

- [x] 현재 기획에 맞춘 스키마·인덱스·Storage 버킷 작성
- [x] 하루 한 편, 1:1 대화, 신고·관리자 처리 RPC 작성
- [x] 모든 공개 테이블에 최소 grant와 RLS 적용

### Checkpoint

- [x] 빈 로컬 DB에서 migration 적용 성공

## Phase 2: Security Verification

- [x] 소유자/타인/관리자/방 멤버 경계 pgTAP 테스트 작성
- [x] DB 테스트와 advisor/lint 실행

### Checkpoint

- [x] 허용·거부 정책 테스트 통과

## Phase 3: App Connection

- [x] Expo용 Supabase 클라이언트와 환경 변수 예시 추가
- [ ] 생성된 Database 타입을 앱에서 사용할 준비

### Checkpoint

- [x] TypeScript와 신규 Supabase 코드 lint 통과

## Phase 4: Initial Content and Admin

- [x] mock 데이터와 1:1 대응하는 seed migration 및 pgTAP 검증
- [x] 로컬 검증 후 원격 프로젝트에 seed migration 적용
- [x] 실제 사용자 초대 후 `app_metadata.role = 'admin'` 지정

### Checkpoint

- [x] 원격 데이터 개수와 관리자 역할을 읽기 전용 쿼리로 검증

## Phase 4.5: Category Taxonomy

- [x] 피드와 글쓰기를 9개 대분류로 통일
- [x] 기존 mock·운영 글을 내용에 맞는 대분류로 이관
- [x] 앱 단위 검사와 DB migration 검증

## Phase 4.6: Trending Hashtags

- [x] 도시·대분류별 사용 빈도를 추천 태그보다 먼저 노출
- [x] 동네 한/영문·오타 별칭을 대표 표기로 통합
- [x] 자유 입력을 중복 없이 최대 5개로 제한

### Checkpoint

- [x] 별칭 검색과 입력·추천 회귀 테스트 통과

## Phase 4.7: AI-assisted Writing

- [x] 사진 촬영·선택과 미리보기
- [ ] 인증된 Edge Function에서 이미지 기반 구조화 초안 생성 (코드 완료, `OPENAI_API_KEY` 설정·배포 대기)
- [x] 제목·본문·대분류·해시태그를 수정 가능한 상태로 채움
- [x] 사용자당 하루 5회 서버 제한

## Phase 5.5: Sharing and Onboarding

- [x] 공유 횟수와 운영 주소/딥링크 생성
- [x] 공유 글 게스트 보기와 상호작용 로그인 게이트
- [x] 카카오 정보 또는 직접 입력 프로필 생성
- [x] 한글·영문 두 단어 랜덤 닉네임

### Checkpoint

- [x] 앱과 원격 DB에 동일한 9개 대분류만 존재

## Phase 5: Authentication Foundation

- [x] 앱 식별자와 딥링크 scheme을 `gling`으로 통일
- [x] mock 인증 상태를 Supabase 세션으로 교체
- [x] 카카오 로그인·세션 복원·로그아웃 연결
- [x] 첫 로그인 후 닉네임·지역 프로필 생성 흐름 연결

### Checkpoint

- [ ] 앱 재실행 후 세션이 유지되고 사용자별 RLS가 적용됨

## Phase 6: Kakao Login

- [x] 앱에는 카카오 로그인만 노출
- [ ] Kakao OAuth 공급자와 `gling://auth/callback` 연결
- [ ] 카카오 계정 탈퇴·연결 해제 운영 흐름 마련

### Checkpoint

- [ ] 카카오 로그인과 로그아웃이 실제 기기에서 동작

## Phase 7: App Data Connection

- [x] 공개 피드·댓글 시드를 Supabase 쿼리로 교체
- [ ] 새 글·댓글·저장·대화를 Supabase 쓰기로 교체

### Checkpoint

- [ ] 실제 로그인 계정으로 글 작성부터 신고·관리자 조회까지 동작

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 관리자 JWT 역할 변경이 즉시 반영되지 않음 | 권한 회수 지연 | 역할 변경 후 세션 갱신·강제 로그아웃 운영 절차 |
| 메시지/피드 증가 | 쿼리 지연 | 작성자·방·커서 페이지네이션 인덱스 선반영 |
| Supabase 프로젝트 정보 없음 | 클라우드 적용 불가 | 로컬 migration과 테스트까지 완료 후 연결 |
| 시드 계정을 실제 사용자로 오인 | 보안·운영 혼선 | 로그인 identity 없이 콘텐츠 작성자 FK로만 사용 |
| 과거 모임 mock이 현재 범위를 확장 | 불필요한 채팅 스키마 | `room_preview` JSON만 보존하고 실제 기능은 보류 |
| OAuth 앱 콜백 불일치 | 로그인 후 앱 복귀 실패 | scheme과 Supabase Redirect URL을 `gling://auth/callback`으로 통일 |
| 카카오 단일 로그인으로 iOS 심사 제출 | 심사 거절 가능성 | 제출 전 최신 App Store 로그인 정책을 다시 확인 |

## Open Questions

- Kakao 개발자 콘솔 자격 증명은 공급자 설정 단계에서 받는다.

## Phase 8: Admin Web MVP

- [x] 관리자 역할 판정과 웹 전용 `/admin` 로그인 게이트
- [x] 전체 신고·사용자·게시글·대화 조회와 사용자 활동 상세
- [x] 신고 처리와 관리자 열람 감사 로그
- [x] 반응형·접근성·브라우저 및 빌드 검증

### Checkpoint

- [x] 일반 사용자는 차단되고 관리자만 전체 데이터와 신고 처리 기능에 접근
- [x] `npm run test:admin && npm run typecheck && npm run lint && npx expo export --platform web` 통과

## Phase 9: Complete User Flow Integration

- [ ] 개발용 실제 Supabase 세션과 웹 세션 영속화
- [ ] 게시글·이미지·일일 서버 쿼터 연결
- [ ] 신고·차단·댓글·공감·저장·조회·공유 연결
- [ ] AI 초안 함수 배포와 비밀값 검증
- [ ] 1:1 DM·모임 신청·Realtime 메시지 연결
- [ ] HTTPS 공유 글과 단일 공개 글 조회
- [ ] 실제 프로필·저장글·통계와 설정 라우트 가드
- [ ] 모바일 웹 내비게이션 겹침 제거
- [ ] 전체 사용자 DB 흐름 테스트와 런타임 검증

### Checkpoint

- [ ] 가입 → 작성 → 상호작용 → 신고 → 관리자 확인 → 대화가 실제 DB 데이터로 이어짐

## Phase 10: Community Hardening

- [ ] 수정 콘텐츠 안전 재검토와 AI 안전 Worker
- [ ] 공유·해시태그·댓글·메시지·대화 생성 어뷰징 제한
- [ ] 모임 신청 → 승인/거절 → 대화 생성 상태 전이
- [ ] 인앱 알림과 관리자 경고/차단 조치
- [ ] 네이티브 글쓰기 진입, 탈퇴·재가입 잠금, 고객문의 자리
- [ ] 피드·댓글·저장글·대화 커서 및 가상 리스트 성능 개선

### Checkpoint

- [ ] `tasks/community-hardening-spec.md` 성공 기준과 전체 자동 검증 통과
