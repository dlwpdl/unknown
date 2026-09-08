# 글링 로그인 검증 — 2026-09-07

대상은 `com.dlwpdl.gling` 1.0.0 (2), 코드 `f123169`와 운영 Supabase 프로젝트 `wjvahbdwmctzpkndqaxa`다. **실제 계정으로 로그인한 뒤 가입·재로그인·탈퇴하는 검증은 아직 완료하지 못했다. 공개 출시 준비 완료를 의미하지 않는다.**

## 로그인 범위

- 사용자는 카카오 중심 가입을 원하며 Google 로그인 추가는 요구하지 않았다. 이전 Google 관련 작업 문구보다 이번 지시를 우선한다.
- Android는 카카오만 표시한다. 현재 iOS 앱은 카카오와 Apple을 표시한다.
- [Apple 심사 기준 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)은 주계정 가입에 소셜 로그인을 사용하는 앱에 이메일 비공개 등 조건을 갖춘 동등한 대체 로그인을 요구한다. 글링에 적용할 예외는 확인되지 않아 iOS에서는 기존 Apple 로그인을 완성하는 방향이 적절하다.
- 일반 카카오 로그인은 국적 인증이 아니다. 현재 요청 정보는 이메일·닉네임·프로필 사진이며, [카카오의 내외국인 정보는 별도 제휴 대상](https://developers.kakao.com/docs/ko/kakaologin/confidential-user-info)이다. 앱 약관도 소셜 로그인을 실명·국적·연령 인증으로 표시하지 않는다.

## 통과한 검사

| 범위 | 결과 |
| --- | --- |
| 앱 자동 검사 | `npm test`: 38개 통과. OAuth 콜백 출처·오류·코드 누락, 개발 로그인 제한, 탈퇴 파일 정리 포함 |
| 정적 검사 | `npm run typecheck`, `npm run lint` 통과 |
| 로컬 DB 통합 검사 | `supabase/tests/*.test.sql` 15개 파일, 162개 검사 통과. 권한·가입 동의·계정 삭제·타인 데이터 보존·안전 검토 정책 포함 |
| 운영 인증 설정 | `/auth/v1/settings` HTTP 200. Kakao 활성, Google·Apple 비활성 |
| 운영 OAuth 시작 | Supabase → Kakao 인가 → `accounts.kakao.com/login` 리다이렉트 확인 |
| 운영 복귀 주소 검증 | 별도로 시작한 테스트 OAuth 요청에서 거절 응답을 모사했을 때 `gling://auth/callback`으로 복귀. 미허용 외부 주소를 요청해도 해당 앱 주소로 복귀 |
| 운영 탈퇴 접근 제어 | 인증 헤더 누락·잘못된 토큰으로 `delete-account` 호출 시 각각 HTTP 401. 사용자 데이터 변경 없음 |
| iOS 실제 앱 | iPhone 16 Pro Max / iOS 18.4 Release. 로그인 권한 요청 취소 후 버튼 복구·재시도·카카오 계정 입력 화면 진입 확인 |
| Android 실제 앱 | Gling_API_36 / Android 16 Release. 카카오 입력 화면 진입, 브라우저 닫기 후 버튼 복구·재시도 확인 |
| Android 인증 거절 | 진행 중인 테스트 로그인에 `gling://auth/callback?error=access_denied`를 전달하자 앱으로 복귀하고 오류 안내·재시도 버튼 표시. 실제 계정 인증 성공을 모사하지 않음 |

Android는 기존 AVD를 `-no-window -no-audio -gpu swiftshader`로 실행했다. 확인 시 `AndroidRuntime:E`, `ReactNativeJS:E` 로그는 비어 있었다.

DB 검사는 운영 서버가 아닌 기존 로컬 `supabase_db_gling`에서 실행했다. 캐시된 Supabase CLI 2.84.2는 현재 `local_smtp` 설정을 해석하지 못해, 기존 Docker의 `psql`로 각 테스트를 실행했다. 각 파일의 `begin;` 직후 `create extension if not exists pgtap with schema extensions;`와 `set local search_path = public, extensions;`를 삽입하고, 오류 종료 코드·TAP 계획·`not ok` 유무를 확인했다. 각 테스트의 `rollback;`으로 테스트 데이터와 임시 확장을 되돌렸다. 운영 데이터나 프로젝트 설정은 변경하지 않았다.

## 남은 실제 검증과 발견 사항

1. **실제 카카오 계정 인증**: 사용자에게 테스트 계정을 선택하고 iPhone 시뮬레이터의 카카오 화면에서 직접 로그인하도록 요청했다. 계정 인증·동의·코드 교환·프로필 생성·앱 재시작 후 세션 복원·로그아웃·재로그인은 아직 미검증이다. 기존 데이터가 있는 사용자 계정은 탈퇴 검증 대상으로 사용하지 않는다.
2. **카카오 연결 해제 누락**: `supabase/functions/delete-account/index.ts`는 글링 데이터·Supabase 계정을 삭제하지만 카카오 연결 해제 API는 호출하지 않는다. [카카오 연결 해제 API](https://developers.kakao.com/docs/ko/kakaologin/rest-api#unlink)는 별도 호출로 동의와 토큰을 폐기한다. 이 경로의 구현 및 실제 테스트 계정 검증이 필요하다. 로컬 DB 탈퇴 검사 통과만으로 외부 카카오 연결 해제까지 통과했다고 볼 수 없다.
3. **Apple 운영 설정**: 공급자가 비활성 상태이고 서버에 `APPLE_CLIENT_SECRET`도 없다. 기존 iOS 로그인과 Apple 계정 삭제는 별도 설정·실기기 검증이 필요하다.
4. **기존 출시 차단 항목**: 운영 secrets에 `OPENAI_API_KEY`, `RESEND_API_KEY`가 여전히 없다. 전체 콘텐츠 안전 분석·관리자 경보와 스토어 필수 정보는 [출시 기록](release-status-2026-09-06.md#심사-제출-전-필수-작업)에 따라 완료해야 한다.

검증 중 앱 코드·운영 인증 설정·스토어 초안은 변경하지 않았다. 실제 계정 입력 이후에 남은 검증을 이어간다.
