# 업체 웹 · 네이버 카페 설정

업체 웹은 기존 공개 웹의 `/merchant/`에 별도로 export한다. `npm run export:web`와 `npm run check:public-web`는 공개 읽기 웹과 업체 웹을 각각 검사한다. 관리자 대시보드는 로컬 관리자 빌드에만 남는다.

기존 글링 계정으로 로그인한다. 관리자 회원 상세에서 업체 권한을 YES로 저장하고, 업체 목록에서 해당 회원을 소유자로 연결·확인한다. 업체 권한과 관리자 역할·개인 멤버십은 별개다. NO는 업체 관리 요청을 차단하며 저장 자료를 삭제하지 않는다. MFA 관리자 대시보드의 기존 운영 권한은 유지된다.

네이버 개발자 센터에서 네이버 로그인과 카페 글쓰기 권한을 신청한 애플리케이션이 필요하다. 서비스 웹은 `https://gling.ej-entertainment.com/merchant/`, 네이버 OAuth callback은 `https://wjvahbdwmctzpkndqaxa.supabase.co/functions/v1/naver-cafe/callback`이다. 글링 로그인에는 기존 Supabase OAuth 제공자 설정과 `https://gling.ej-entertainment.com/merchant/auth/callback` redirect allowlist도 필요하다.

서버의 `naver-cafe` Edge Function에만 다음 비밀값을 설정한다. 저장소·EXPO_PUBLIC 환경 변수·브라우저·채팅에 복사하지 않는다.

- `NAVER_CAFE_CLIENT_ID`, `NAVER_CAFE_CLIENT_SECRET`: 네이버 개발자 앱의 실제 값.
- `NAVER_CAFE_TOKEN_KEY`: 독립적인 32바이트 난수를 base64로 인코딩한 AES-GCM 키. 변경하면 기존 연결 토큰을 복호화할 수 없으므로 해당 업체가 다시 연결해야 한다.
- `NAVER_CAFE_RETURN_URL`: `https://gling.ej-entertainment.com/merchant/` 같은 고정 HTTPS 업체 웹 주소. 입력으로 redirect를 바꾸지 않는다.
- `NAVER_CAFE_ALLOWED_ORIGINS`: 로컬 검증이 필요할 때만 정확한 origin을 쉼표로 지정한다. 기본 운영 origin 외의 요청은 거부한다.

배포 후 키가 없으면 `미설정` 상태를 표시한다. 카페 홈의 이름으로 숫자 ID를 추측하지 않는다. 실제 게시판의 `/f-e/cafes/{clubid}/menus/{menuid}` 주소 또는 ArticleList의 clubid/menuid가 있는 URL을 사용한다. 업체 소유자가 직접 네이버 승인을 완료하고 해당 카페에 가입·등업해야 한다.

게시 전 승인된 저장 원고와 사진 순서를 확인한다. 한 계정에서 하루 3회까지 한 건씩 게시한다. 실제 네이버 응답의 게시글 URL을 받아야 완료로 기록한다. timeout이나 완료 기록 실패는 같은 글을 자동 재전송하지 않는다. 준비 단계만 원자적으로 취소할 수 있으며, 전송 중·결과 불확실 상태는 실제 카페에서 확인한다. 토큰 연결을 해제해도 이미 게시된 카페 글은 남는다.

사진은 기존 글링 업로드 규칙인 최대 6장·각 2MiB를 사용한다. 서버에서 실제 파일 크기·MIME·파일 헤더를 확인한다. 공식 API 문서에서 WebP 지원을 보장하지 않으므로 실제 연결 계정으로 호환성을 확인해야 한다. 사진 거절을 게시 완료로 표시하지 않는다.

운영 기록과 실제 검증을 구분한다. 모의 OAuth·저장 응답·중복 방지 테스트는 실제 네이버 승인, 카페 쓰기 권한, WebP 호환 또는 외부 발행 성공의 증거가 아니다. 고객용 외부 AI 연결/MCP는 이번 변경에 포함하지 않는다. 기존 관리자 AI 도구는 기존 MFA 관리자 범위를 유지한다.

공식 API: https://developers.naver.com/docs/login/api/api.md ; https://developers.naver.com/docs/login/cafe-api/cafe-api.md
