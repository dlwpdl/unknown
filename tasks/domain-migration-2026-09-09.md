# 글링 도메인 이전 — 2026-09-09

운영 주소: https://gling.ej-entertainment.com
사용자가 구매한 ej-entertainment.com의 gling CNAME을 직접 추가했다. 글링만 변경했으며 루트·메일·rottery DNS는 변경하지 않았다.

## 완료

- DNS: gling → dlwpdl.github.io. 로컬 DNS 및 1.1.1.1에서 GitHub Pages IP 확인.
- GitHub Pages: custom domain 연결, 인증서 approved(2026-12-08 만료), HTTPS 강제 활성화.
- 배포: ff191977ddbf480cab6b9afd3e825b61c639fd46, [성공 실행](https://github.com/dlwpdl/gling/actions/runs/34421908961). 루트 경로 빌드, 공개 URL 기본값·환경변수 예시·현재 홍보 초안·스토어 자료 변경.
- Supabase wjvahbdwmctzpkndqaxa: 새 /auth/callback을 원격 uri_allow_list에 추가하고 재조회. 기존 콜백 및 site_url=gling://auth/callback을 보존했다. 공급자 비밀키·로그인 정책은 변경하지 않았다.
- App Store Connect 6809273242: 한국어 개인정보·계정 삭제·마케팅·지원 URL 및 설명 속 URL 적용. 재계획 결과 차이 0개. .asc/domain-migration-review 및 .asc/domain-migration-verify에 로컬 증거.
- Google Play: 웹사이트 URL 저장 및 출시 후 새로고침 재확인. 개인정보 URL 저장 후 재확인. 계정 삭제 URL은 기존 데이터 보안 초안에 임시저장하고 새로고침→2단계에서 재확인.
- Google Play 개인정보 변경은 검토 전송 대기, 데이터 보안 선언은 기존 미완료 초안 상태다. 전체 앱 공개 심사·출시는 실행하지 않았다.

## 검증

- 인증 6개·공유 2개 테스트, TypeScript, 메타데이터 형식 검사, 웹 export 통과.
- 새 HTTPS 홈·privacy·terms·account-deletion·auth/callback 모두 200, 홈의 JS/CSS 에셋 모두 200 및 이전 /gling 에셋 경로 없음.
- 이전 https://dlwpdl.github.io/gling/ 및 privacy/account-deletion 링크는 새 HTTPS 주소로 리디렉션 후 200.
- Orca Git → gling의 기존 공개 사이트 탭을 새 주소로 이동하여 실제 페이지와 법적 안내 링크 확인. 페이지 ID 9267aa68-d3b4-460e-b5b7-762a4bcd3d94, 워크스페이스 folder:e88d505b-f6bb-47d6-ba41-904ef2a72a8b.
- 도메인 변경 후 개인 계정 소셜 로그인 전체 과정은 재실행하지 않았다. 허용 콜백 설정과 callback 페이지 접근을 검증했다.

## 보존 및 후속

- 배포된 네이티브 빌드 6의 예전 링크는 사이트 리디렉션으로 지원한다. 새 기본 URL은 다음 네이티브 빌드에 반영된다.
- 공유 미리보기 Supabase 함수 주소와 네이티브 gling:// scheme, 번들 ID·패키지 이름은 유지한다.
- 날짜별 과거 실행 기록은 역사적 사실이므로 일괄 치환하지 않았다.
- 롤백: 이전 /gling 빌드 경로·공개 URL로 복원 후 재배포하고 Pages custom domain을 제거한다. DNS 레코드는 사이트 상태를 확인한 후 정리한다.
