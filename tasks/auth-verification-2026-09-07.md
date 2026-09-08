# 글링 로그인 검증 — 2026-09-07

**2026-09-08 후속:** Apple 공급자·서버 키 설정, 외부 계정 연결 해제 후 데이터 삭제 보호, 새 iOS 시뮬레이터의 카카오 입력 화면 진입, 빌드 4와 내부 테스트 상태는 [후속 검증](release-followup-2026-09-08.md)을 참조한다. 아래의 공급자 비활성·키 누락·스토어 초안 상태는 당시 기록이며 일부 해소됐다.

초기 검사 대상은 `com.dlwpdl.gling` 1.0.0 (2), 코드 `f123169`와 운영 Supabase 프로젝트 `wjvahbdwmctzpkndqaxa`다. 이후 발견한 KOE205 오류의 빌드 3 수정은 아래에 기록했다. **실제 계정으로 로그인한 뒤 가입·재로그인·탈퇴하는 검증은 아직 완료하지 못했다. 공개 출시 준비 완료를 의미하지 않는다.**

## 로그인 범위

- 사용자는 카카오 중심 가입을 원하며 Google 로그인 추가는 요구하지 않았다. 이전 Google 관련 작업 문구보다 이번 지시를 우선한다.
- Android는 카카오만 표시한다. 현재 iOS 앱은 카카오와 Apple을 표시한다.
- [Apple 심사 기준 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)은 주계정 가입에 소셜 로그인을 사용하는 앱에 이메일 비공개 등 조건을 갖춘 동등한 대체 로그인을 요구한다. 글링에 적용할 예외는 확인되지 않아 iOS에서는 기존 Apple 로그인을 완성하는 방향이 적절하다.
- 일반 카카오 로그인은 국적 인증이 아니다. 빌드 3부터 카카오 요청 정보는 닉네임·프로필 사진이며, [카카오의 내외국인 정보는 별도 제휴 대상](https://developers.kakao.com/docs/ko/kakaologin/confidential-user-info)이다. 앱 약관도 소셜 로그인을 실명·국적·연령 인증으로 표시하지 않는다.

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

1. **실제 카카오 계정 인증**: 사용자가 본인 계정으로 로그인한 뒤 KOE205를 보고했다. 빌드 3으로 해당 권한 요청을 수정했다. 동의·코드 교환·프로필 생성·앱 재시작 후 세션 복원·로그아웃·재로그인은 아직 미검증이다. 기존 데이터가 있는 사용자 계정은 탈퇴 검증 대상으로 사용하지 않는다.
2. **카카오 연결 해제 누락**: `supabase/functions/delete-account/index.ts`는 글링 데이터·Supabase 계정을 삭제하지만 카카오 연결 해제 API는 호출하지 않는다. [카카오 연결 해제 API](https://developers.kakao.com/docs/ko/kakaologin/rest-api#unlink)는 별도 호출로 동의와 토큰을 폐기한다. 이 경로의 구현 및 실제 테스트 계정 검증이 필요하다. 로컬 DB 탈퇴 검사 통과만으로 외부 카카오 연결 해제까지 통과했다고 볼 수 없다.
3. **Apple 운영 설정**: 공급자가 비활성 상태이고 서버에 `APPLE_CLIENT_SECRET`도 없다. 기존 iOS 로그인과 Apple 계정 삭제는 별도 설정·실기기 검증이 필요하다.
4. **기존 출시 차단 항목**: 운영 secrets에 `OPENAI_API_KEY`, `RESEND_API_KEY`가 여전히 없다. 전체 콘텐츠 안전 분석·관리자 경보와 스토어 필수 정보는 [출시 기록](release-status-2026-09-06.md#심사-제출-전-필수-작업)에 따라 완료해야 한다.

위 초기 검사에서는 앱 코드·운영 인증 설정·스토어 초안을 변경하지 않았다.

## 후속 수정: 카카오 KOE205, 빌드 3

iPhone 16 Pro Max의 실제 오류 화면에서 `설정하지 않은 동의 항목: account_email`을 확인했다. 카카오에 허용되지 않은 이메일 권한을 Supabase가 기본으로 요청한 것이 원인이다. [카카오 오류 안내](https://developers.kakao.com/docs/ko/kakaologin/trouble-shooting), [Supabase 카카오 설정](https://supabase.com/docs/guides/auth/social-login/auth-kakao).

`src/lib/auth.tsx`의 공통 로그인 호출에 `queryParams: { scope: 'profile_nickname profile_image' }`를 추가했다. 모든 로그인 버튼이 이 함수를 사용한다. `options.scopes`는 기본 권한에 추가하므로 사용하지 않았다. 운영 설정을 읽어 `external_kakao_email_optional=true`임을 확인했으며 서버 설정과 자격 증명은 변경하지 않았다. 프로필 가입은 이메일 대신 인증된 사용자 ID를 사용한다.

- Node에서 생성한 요청에 대한 운영 서버의 실제 HTTP 302 응답 비교: 기존 요청은 `account_email profile_image profile_nickname`, 수정 요청은 `profile_nickname profile_image`. 이 비교 요청의 PKCE 방식은 S256이며 앱 복귀 주소를 유지했다.
- 수정 후 `npm test` 38/38, TypeScript, ESLint 통과. DB 변경이 없어 앞서 통과한 162개 DB 검사는 반복하지 않았다.
- Android Release 3 설치, 카카오 계정 입력 화면 진입, 취소·재시도, 인증 거절 콜백 후 오류 안내와 재시도 버튼을 확인했다. 최종 AndroidRuntime·ReactNativeJS 오류 로그는 비어 있었다. 초기 에뮬레이터 System UI 응답 지연은 회복 후 다시 확인했다.
- iOS Release 3 시뮬레이터 빌드·설치와 App Store Archive·Export를 완료했다. iOS 서명·entitlement·번들 ID·버전, Android 업로드 인증서·16KB 정렬·권한 검사를 통과했다. 양쪽 최종 JS 번들에 수정한 권한 문자열이 포함됐다.
- iOS Release 3의 앱 내 인증 창에서는 Supabase 주소에서 `네트워크 연결이 유실되었기 때문에 Safari가 해당 페이지를 열 수 없습니다`가 반복됐다. 새 로그인 요청·새로고침·해당 시뮬레이터 재시작 후에도 재현됐다. 같은 시뮬레이터의 일반 Safari에서는 별도로 생성한 비교 요청으로 카카오 입력 화면까지 열렸다. 이 비교는 앱 자체의 로그인 성공을 증명하지 않으며, 빌드 3의 iOS 인증 완료는 아직 확인하지 못했다.
- iOS 네이티브 인증 창에 전달되는 실제 URL을 디버거로 확인했다. 권한은 `profile_nickname profile_image`, 복귀 주소는 `gling://auth/callback`이며, 네이티브 SDK의 PKCE 방식은 `plain`이었다. 같은 URL의 운영 서버 응답은 HTTP 302와 정확한 카카오 권한이었다. 인증과 무관한 `/auth/v1/settings`도 기본 인증 창에서 연결에 실패했지만 `example.com`은 열렸다.
- 브라우저 세션 비교: 기본 세션에서 실패 → 프로세스 안에서만 임시 세션 옵션을 켜면 카카오 계정 입력 화면 도달 → 기본 세션으로 재시도하면 다시 실패했다. 기존 인증 브라우저 세션의 영향을 확인했으며, 세부 원인은 미확정이다. 이 진단 옵션과 URL 교체는 배포 코드에 반영하지 않았고 디버거를 분리했다. 실제 계정 인증·앱 복귀 성공으로 기록하지 않는다.
- 해당 시뮬레이터의 Safari 설정에서 웹사이트 데이터는 `0바이트`로 표시됐다. 삭제할 개별 Supabase 항목이 없어 데이터 삭제는 실행하지 않았다. 캐시나 쿠키 손상으로 원인을 단정하지 않는다.
- App Store Connect 빌드 `50e9aa6e-9582-4304-9da0-57caa2b50a54`가 `VALID`로 처리됐고 기존 버전 `1fe513b3-ec8d-4b00-bc4e-09c6a5087088`에 연결됐다. 상태는 `PREPARE_FOR_SUBMISSION`이다. 한국어 What to Test를 저장했고 `asc validate testflight`는 오류·경고 0이다. 테스터 초대나 심사 제출은 하지 않았다.
- Play 내부 테스트 초안을 `1.0.0 (3)`으로 저장하고 새로고침 후 빌드 3만 선택된 상태와 한국어 변경 안내를 재확인했다. 빌드 2는 라이브러리에 남았다. 테스터 미지정·ReTrace 파일 없음 경고 2개는 유지된다. R8 난독화는 사용하지 않으며 네이티브 디버그 기호 48개는 첨부됐다. `저장 및 출시`는 실행하지 않았다.

배포 파일과 dSYMs는 `~/Library/Application Support/gling/releases/1.0.0-3/`, 작업 기록은 `/tmp/gling-kakao-fix-3/`에 보관했다. [한국어 변경 안내](../release/notes-1.0.0-3-ko.txt).

| 파일 | SHA-256 |
| --- | --- |
| gling-1.0.0-3.ipa | `5bae01feda7ee4d2066c8a9d254f403c2f84419d67dd9642cba736b3ae277af0` |
| gling-1.0.0-3.aab | `5e0136b758ea048acd3ef97cf8bcd6bcb78f4d999c03b6e3e6807be58b7fc121` |
| gling-1.0.0-3.apk | `e0cc4a3d451a743380ef6d331234a3002f26ec598bc315078a9e8c14d7acddd9` |

회귀 확인은 Release 3의 `gling://profile`에서 카카오 로그인을 시작하고 실제 계정으로 인증하여 KOE205 없이 동의·앱 복귀 화면에 도달하는지 확인한다. 본인 계정의 가입 동의와 데이터 삭제를 자동으로 수행하지 않는다.
