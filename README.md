# 글링

브랜드와 앱 표시 이름은 **글링**, 영문 로고는 **gling**을 사용합니다. Google Play 등록명은 `글링`입니다. App Store에서는 단독 이름이 이미 사용 중이므로 `글링 - 캐나다 한인 커뮤니티`를 사용합니다. `app.json`의 한글 홈 화면 이름은 다음 네이티브 빌드부터 적용됩니다.

밴쿠버·토론토 한인 커뮤니티. Expo SDK 57, React Native, Supabase를 사용합니다.

저장소는 **[dlwpdl/gling](https://github.com/dlwpdl/gling)**, 앱 작업 브랜치는 `mobile-app`입니다.

## 실행

Node.js 22.13 이상과 npm을 사용합니다.

```sh
npm ci
cp .env.example .env.local
# .env.local에 기존 Supabase 프로젝트의 공개 URL·publishable key를 설정합니다.
npm start
```

`npm run ios`는 Xcode와 CocoaPods가 필요합니다. 네이티브 `ios/`는 `app.json`에서 생성되며 Git에 저장하지 않습니다. 서버용 비밀키는 Supabase Edge Function secrets에만 설정합니다.

## 검증

```sh
npm test
npm run typecheck
npm run lint
npx expo install --check
npx expo export --platform web
npx supabase test db # 실행 중이며 최신 migration이 적용된 로컬 Supabase 필요
```

## 출시

- [App Store 한국어 메타데이터](tasks/app-store-metadata-ko-KR.md)
- [출시 검증 결과와 남은 작업](tasks/release-status-2026-09-06.md)
- [Google Play 등록·Android 빌드 기록](tasks/google-play-release-2026-09-06.md)
- [Google Play 아이콘·홍보 이미지·실제 화면](release/google-play/README.md)
- [안전 모니터링·관리자 접근 정책](docs/decisions/0001-safety-monitoring-and-admin-access.md)
- [개인정보처리방침](https://dlwpdl.github.io/gling/privacy) · [이용약관](https://dlwpdl.github.io/gling/terms) · [계정 삭제](https://dlwpdl.github.io/gling/account-deletion)

`mobile-app`에 푸시하면 기존 GitHub Pages 워크플로가 웹사이트를 배포합니다. TestFlight·Google Play 빌드 업로드와 각 스토어 심사는 별도 단계입니다.
