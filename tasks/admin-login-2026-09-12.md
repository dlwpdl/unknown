# 로컬 어드민 접속 복구 — 2026-09-12

- 사용자 요청으로 주소를 **http://localhost:54321/**에 고정했다. 서버는 `127.0.0.1`에만 바인딩하고 포트가 사용 중이면 실패하며 다른 포트로 자동 변경하지 않는다. 다시 실행할 때는 저장소에서 `npm run admin`을 사용한다.
- 이전 `.admin-dist`가 로컬 Supabase `127.0.0.1:54321`로 빌드돼 Google 로그인에 `Unsupported provider`가 발생했다. 운영 `.env.local`로 관리자 export를 다시 만들었다. 새 번들에는 운영 글링 Supabase URL이 있고 로컬 인증 URL은 없다.
- 운영 Google provider는 이미 활성 상태였다. 계정 비밀번호·권한·로그인 공급자 설정을 변경하지 않았다. 해당 관리자 계정의 Google 연동과 관리자 권한을 확인했다.
- 이전 8181 관리자 프로세스와 글링 로컬 Supabase 컨테이너 11개를 종료했다. 컨테이너·볼륨·데이터는 보존했다. 다음 로컬 Supabase 실행 시 API는 `supabase/config.toml`의 54331을 사용한다.
- 확인: 54321 루트와 `/auth/callback` HTTP 200, 현재 포트의 운영 Google authorize HTTP 302 → accounts.google.com, 8181 리스너 없음. Orca의 `Git → gling`에서 같은 주소의 인증된 운영 콘솔과 회원 분석 화면이 실제로 열리는 것도 확인했다.
