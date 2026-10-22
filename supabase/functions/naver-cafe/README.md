# 업체 네이버 카페 연결

2026-10-08. 기존 글링 로그인과 업체 관리 YES 권한에 추가되는 연결 기능이다. 네이버 비밀번호를 받지 않는다. 실제 소유 확인을 마친 **현재 업체 소유자**만 사용할 수 있으며, 관리자 역할은 다른 업체의 연결 권한을 주지 않는다.

## 준비

1. 네이버 개발자 애플리케이션에서 로그인과 카페 쓰기 API 권한을 신청·승인한다. 연결할 계정은 카페 가입·등업·게시판 쓰기 권한을 직접 준비해야 한다. 상품 게시판은 공식 API로 쓸 수 없다.
2. 업체 웹을 HTTPS 주소에 배포하고 `NAVER_CAFE_RETURN_URL`에 그 실제 고정 루트 주소를 설정한다. 네이버에 등록하는 callback은 `https://<기존 프로젝트>.supabase.co/functions/v1/naver-cafe/callback`이다.
3. 서버 전용 secret `NAVER_CAFE_CLIENT_ID`, `NAVER_CAFE_CLIENT_SECRET`, `NAVER_CAFE_TOKEN_KEY`(32 bytes, base64), `NAVER_CAFE_RETURN_URL`을 설정한다. 필요한 개발 origin만 `NAVER_CAFE_ALLOWED_ORIGINS`에 쉼표로 열거한다. `EXPO_PUBLIC_*`에 넣지 않는다. 암호화 키를 바꾸면 기존 계정은 다시 연결해야 한다.
4. 순서대로 migration `0129`, `0130`과 기존 `naver-cafe` Edge function 설정을 배포한다. callback은 공개 GET이므로 gateway `verify_jwt=false`, 모든 POST는 handler의 실제 `auth.getUser()`와 DB의 현재 권한 검사를 통과해야 한다.

현재 작업 환경에는 서버 secret이 등록되지 않았고, 사용할 개발자 앱과 실제 카페는 확인 대기다. 미설정 상태에서 연결·발행은 실행되지 않는다. 코드·로컬 모의 테스트 완료와 실제 외부 연결/발행 완료는 별도다.

## 사용자 흐름

업체 웹에서 네이버 계정 연결 → 네이버 동의 → 고정 업체 웹으로 복귀 → 현재 글링 계정의 bearer 인증으로 `complete` 요청. 웹 루트는 callback query를 즉시 제거하고 메모리에만 보관한다. state는 현재 계정·업체에 묶이고, 서버에서 해시만 저장하며, 10분 이내 한 번만 소비한다. 저장 직전에 현재 업체 권한과 실제 소유자·확인 상태를 다시 검사한다.

발행할 게시판의 실제 `https://cafe.naver.com/f-e/cafes/<숫자>/menus/<숫자>` 또는 `ArticleList.nhn?search.clubid=…&search.menuid=…` 주소를 붙여넣는다. 카페 홈 slug에서 ID를 추측하지 않는다. 최신 저장 원고를 승인하고 제목·본문·사진 순서·게시판을 확인한 후 한 건씩 발행한다. API 기본 회원 공개를 사용하며 CCL 허용을 자동 부여하지 않는다. UI에서 이 공개 범위를 설명한다.

네이버 `articleUrl` 성공 응답을 확인하고 원고의 `external_url`에 저장한 경우만 게시 완료다. 가입·CAPTCHA·등업을 자동 실행하지 않는다. 연결됨은 카페 쓰기 권한 확인이나 게시 완료를 뜻하지 않는다. 서버 API에는 unattended batch publishing 기능이 없다.

## 경계와 복구

- 토큰은 AES-GCM으로 업체·계정에 묶어 암호화한다. private 테이블에 RLS를 적용하고 인증/익명/service role의 직접 테이블 접근을 모두 막는다. service role 전용 RPC만 암호문을 읽고 갱신할 수 있다. client와 로그로 반환하지 않는다. 계정 삭제 때 토큰·state·본문 snapshot을 지운다.
- 매 요청은 DB의 실제 `auth.users.raw_app_meta_data.merchant_enabled === true`, 활성 계정, 본인 업체 소유·확인·운영 상태를 검사한다. 오래된 JWT의 YES나 관리자 권한으로 우회할 수 없다. SQL 검사 중 해당 권한/소유 행을 잠근다. 이미 시작된 네이버 요청은 NO 전환으로 회수할 수 없으며, 새 발행은 막힌다.
- 외부 원고는 기존 `assert_content_allowed`와 active watch terms를 재사용해 발행 전·claim 직전에 거절한다. 요청에는 승인된 실제 원고·사진 경로·actor snapshot을 남긴다. 내부 게시글의 기존 안전 검토는 그대로다. 네이버 원고에 비동기 AI 안전 검토를 완료했다고 표시하지 않는다.
- 인증된 현재 사용자의 고정 `post-images` 저장소에서 본인 사진만 읽는다. 앱과 동일한 6장/2MiB 및 JPEG·PNG·WebP MIME+시그니처 검사를 적용한다. 네이버 공식 문서에는 최대 바이트/MIME 목록이 명시되지 않았다. 앱의 WebP 저장본 호환은 실제 계정으로 미검증이며, 거절을 성공으로 처리하지 않는다.
- durable request ID, 원고 revision, 게시판, 사진 순서가 일치해야 한다. 같은 revision은 한 요청만 존재한다. `prepared → in_flight` row lock을 얻은 한 호출만 네이버 POST를 실행한다. 동일 요청이나 timeout의 외부 POST를 자동 재시도하지 않는다. 하루 3회의 dispatch 한도는 시도에 적용된다.
- `in_flight`/`uncertain` 원고는 결과 확인 전 수정·재발행을 멈춘다. 운영자는 실제 카페와 요청 기록을 확인해야 하며, 상태를 임의로 성공 처리하면 안 된다. 외부 성공 후 DB receipt 저장이 불확실하면 반환된 실제 링크를 사용자별 로컬 pending에 보관하고 서버 기록 미확인으로 표시한다.
- 재진입·상태 확인에서 실제 `succeeded`/`failed` readback을 얻으면 로컬 pending만 정리한다. `prepared`는 사용자가 원자 취소한 서버 readback을 확인해야 해제한다. 늦은 worker는 취소된 준비 요청을 claim할 수 없다. 불확실/미확인 요청은 유지한다.
- 해제는 로컬 토큰을 먼저 제거하고 공식 POST `/oauth2.0/revoke`에 refresh token을 보낸다. 빈 HTTP 200이 성공이며 연결된 access/refresh token을 함께 폐기한다. provider 폐기에 실패해도 글링의 저장 토큰은 삭제하고 네이버 연결 서비스에서 확인할 안내를 표시한다. 이미 게시한 카페 글은 삭제하지 않는다.

## 검증

`node --experimental-strip-types --test scripts/naver-cafe*.test.mjs`, 변경 앱/shared `npx eslint`, `npx tsc --noEmit`. 로컬 Docker `supabase_db_gling`에만 적용한 migration과 `supabase/tests/naver_cafe.test.sql` pgTAP는 실제 권한·OAuth 단회/만료·타 계정·NO·저장 revision·사진 소유·감시어·claim 중복·원고 동결·취소 경쟁·receipt·개인정보 삭제를 검증한다. 테스트 fixtures는 rollback하고 외부 HTTP나 실제 카페 글을 생성하지 않는다.

공식 문서: [카페 API](https://developers.naver.com/docs/login/cafe-api/cafe-api.md), [로그인/OAuth/revoke API](https://developers.naver.com/docs/login/api/api.md). 실제 네이버 승인과 연결, 권한·한국어 인코딩·사진 호환, 공개 웹 hosting과 callback 배포는 설정 후 검증해야 한다.
