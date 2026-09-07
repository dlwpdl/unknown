# 글링

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
- [안전 모니터링·관리자 접근 정책](docs/decisions/0001-safety-monitoring-and-admin-access.md)
- [개인정보처리방침](https://dlwpdl.github.io/gling/privacy) · [이용약관](https://dlwpdl.github.io/gling/terms) · [계정 삭제](https://dlwpdl.github.io/gling/account-deletion)

`mobile-app`에 푸시하면 기존 GitHub Pages 워크플로가 웹사이트를 배포합니다. TestFlight 업로드와 App Store 심사는 별도 단계입니다.
